const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const userRoutes = require('./routes/userRoutes');
const accessRoutes = require('./routes/accessRoutes');
const authRoutes = require('./routes/authRoutes');
const { seedAdmin } = require('./controllers/authController');
const db = require('./config/db');

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json());

// Serve static frontend files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/access', accessRoutes);

// --- EXPLICIT /api/events/latest ROUTE WITH SLOT ID JOIN ---
app.get('/api/events/latest', async (req, res) => {
    try {
        let result;
        try {
            result = await db.query(
                `SELECT l.*, u.full_name, u.employee_code, u.department, u.fingerprint_slot_id AS slot_id 
                 FROM attendance_logs l 
                 JOIN users u ON l.user_id = u.id 
                 ORDER BY l.timestamp DESC LIMIT 20`
            );
        } catch (e) {
            try {
                result = await db.query(
                    `SELECT e.*, u.full_name, u.employee_code, u.department, u.fingerprint_slot_id AS slot_id 
                     FROM attendance_events e 
                     JOIN users u ON e.user_id = u.id 
                     ORDER BY e.timestamp DESC LIMIT 20`
                );
            } catch (err) {
                result = { rows: [] };
            }
        }
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching latest events:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.use('/api/events', accessRoutes);

// --- REMOTE ESP32 HARDWARE ENROLLMENT QUEUE STATE ---
let enrollmentQueue = {
    enroll: false,
    slot_id: null
};

// Admin endpoint triggered when clicking "Trigger ESP32 Enrollment" on dashboard
app.post('/api/access/enroll/trigger', (req, res) => {
    const { slot_id } = req.body;
    if (!slot_id) {
        return res.status(400).json({ error: "slot_id is required" });
    }
    enrollmentQueue = {
        enroll: true,
        slot_id: parseInt(slot_id, 10)
    };
    console.log(`[ENROLL QUEUE] Queued slot ID #${slot_id} for remote hardware enrollment.`);
    res.json({ success: true, message: `Slot #${slot_id} queued for hardware enrollment.` });
});

// ESP32 polls this endpoint continuously
app.get('/api/access/enroll/poll', (req, res) => {
    res.json(enrollmentQueue);
});

// ESP32 posts back here when enrollment finishes to clear the queue
app.post('/api/access/enroll/complete', (req, res) => {
    console.log(`[ENROLL QUEUE] Hardware enrollment complete for slot #${req.body.slot_id}. Clearing queue.`);
    enrollmentQueue = {
        enroll: false,
        slot_id: null
    };
    res.json({ success: true, message: "Queue cleared." });
});

// --- NEW: Handle Unknown / Denied Access Events for Live Terminal ---
app.post('/api/events/access-denied', async (req, res) => {
    try {
        const { message, fingerprint_slot_id } = req.body;
        const denyMessage = message || `🚨 ACCESS DENIED: Unknown Fingerprint Scanned (Slot #${fingerprint_slot_id || 'N/A'})`;

        console.log(`[TERMINAL LOG] ${denyMessage}`);

        // If you use req.app.get('io') or global broadcasting for live terminal feed
        const io = req.app.get('io');
        if (io) {
            io.emit('terminal_log', {
                timestamp: new Date().toISOString(),
                status: 'DENIED',
                message: denyMessage
            });
        }

        return res.status(200).json({
            success: true,
            message: "Denied event logged to terminal successfully."
        });
    } catch (err) {
        console.error('Access Denied Logging Error:', err.message);
        return res.status(500).json({ error: `Failed to log denied event: ${err.message}` });
    }
});

// NEW: Handle user enrollment and fingerprint slot assignment (Fixes 404 Error)
app.post('/api/enroll', async (req, res) => {
    try {
        const { full_name, id_number, employee_code, contact_number, email_address, department, user_role, fingerprint_slot, admin_password } = req.body;
        
        console.log("Enrollment request received for:", full_name, "Slot:", fingerprint_slot, "Role:", user_role);

        const queryText = `
            INSERT INTO users (full_name, id_number, employee_code, contact_number, email_address, department, user_role, fingerprint_slot_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *;
        `;
        
        let result;
        try {
            result = await db.query(queryText, [
                full_name || 'Unknown', 
                id_number || '', 
                employee_code || '', 
                contact_number || '', 
                email_address || '', 
                department || 'ICT', 
                user_role || 'Standard Employee', 
                fingerprint_slot || null
            ]);

            // Automatically sync admin credentials if registered as an admin
            const roleLower = (user_role || '').toLowerCase();
            if (roleLower === 'admin' || roleLower === 'administrator') {
                const adminUsername = email_address || employee_code;
                const rawPassword = admin_password || 'Admin@123';
                const hashedPassword = await bcrypt.hash(rawPassword, 10);

                await db.query(
                    `INSERT INTO admin_users (username, password_hash, role) 
                     VALUES ($1, $2, $3)
                     ON CONFLICT (username) 
                     DO UPDATE SET password_hash = $2, role = $3`,
                    [adminUsername, hashedPassword, 'ADMIN']
                );
                console.log(`[ADMIN SYNC] Created/Updated admin login for: ${adminUsername}`);
            }

        } catch (dbErr) {
            console.error("Database insert error during enrollment:", dbErr.message);
            return res.status(500).json({ error: `Database error during enrollment: ${dbErr.message}` });
        }

        res.status(201).json({
            success: true,
            message: "User enrolled successfully",
            user: result.rows[0]
        });
    } catch (err) {
        console.error('Enrollment Error:', err.message);
        res.status(500).json({ error: `Failed to enroll user: ${err.message}` });
    }
});

// NEW: PDF Attendance Export Route (Paired Entry & Exit on a single line)
app.get('/api/events/export/pdf', async (req, res) => {
    try {
        const targetDate = req.query.date || new Date().toISOString().slice(0, 10);
        console.log("PDF Export requested for target date:", targetDate);
        
        // Fetch records safely with fallback table check
        let result;
        try {
            result = await db.query(
                `SELECT l.*, u.full_name, u.employee_code, u.department 
                 FROM attendance_logs l 
                 JOIN users u ON l.user_id = u.id 
                 ORDER BY l.timestamp ASC`
            );
        } catch (e) {
            try {
                result = await db.query(
                    `SELECT e.*, u.full_name, u.employee_code, u.department 
                     FROM attendance_events e 
                     JOIN users u ON e.user_id = u.id 
                     ORDER BY e.timestamp ASC`
                );
            } catch (err) {
                result = { rows: [] };
            }
        }

        console.log("Total rows fetched from DB:", result.rows.length);

        // Filter rows strictly by the target date converted to local SAST time
        const rows = (result.rows || []).filter(row => {
            const dateVal = row.timestamp || row.log_date || row.created_at || row.date;
            if (!dateVal) return false;
            
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return false;

            let rowDateFormatted;
            try {
                rowDateFormatted = d.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
            } catch (e) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                const day = String(d.getDate()).padStart(2, '0');
                rowDateFormatted = `${year}-${month}-${day}`;
            }

            return rowDateFormatted === targetDate;
        });

        // Group rows into attendance sessions per user (pairing ENTRY and subsequent EXIT)
        const sessions = [];
        const activeEntries = {};

        rows.forEach(row => {
            const userId = row.user_id;
            const eventType = (row.event_type || row.status || '').toUpperCase();
            
            const timeSource = row.timestamp || row.log_date || row.created_at;
            let eventTime = 'N/A';
            if (timeSource) {
                const d = new Date(timeSource);
                if (!isNaN(d.getTime())) {
                    try {
                        eventTime = d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Johannesburg', hour12: false });
                    } catch (err) {
                        eventTime = d.toTimeString().slice(0, 8);
                    }
                }
            }

            if (eventType.includes('ENTRY')) {
                if (activeEntries[userId]) {
                    sessions.push(activeEntries[userId]);
                }
                activeEntries[userId] = {
                    full_name: row.full_name || 'Unknown',
                    employee_code: row.employee_code || 'N/A',
                    department: row.department || 'N/A',
                    entryTime: eventTime,
                    exitTime: 'N/A'
                };
            } else if (eventType.includes('EXIT')) {
                if (activeEntries[userId]) {
                    activeEntries[userId].exitTime = eventTime;
                    sessions.push(activeEntries[userId]);
                    delete activeEntries[userId];
                } else {
                    sessions.push({
                        full_name: row.full_name || 'Unknown',
                        employee_code: row.employee_code || 'N/A',
                        department: row.department || 'N/A',
                        entryTime: 'N/A',
                        exitTime: eventTime
                    });
                }
            }
        });

        Object.values(activeEntries).forEach(session => {
            sessions.push(session);
        });

        console.log("Processed attendance sessions for PDF:", sessions.length);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${targetDate}.pdf`);

        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({ margin: 30 });
        doc.pipe(res);

        doc.fontSize(18).text(`Daily Attendance Report - ${targetDate}`, { align: 'center' });
        doc.moveDown();

        if (sessions.length === 0) {
            doc.fontSize(12).text(`No attendance records found for ${targetDate}.`, { align: 'center' });
        } else {
            sessions.forEach((s, i) => {
                doc.fontSize(10).text(
                    `${i + 1}. ${s.full_name} (${s.employee_code}) - ${s.department} - Entry: ${s.entryTime} | Exit: ${s.exitTime}`
                );
            });
        }

        doc.end();
    } catch (err) {
        console.error('Detailed PDF Generation Error:', err.message, err.stack);
        res.status(500).json({ error: `Failed to generate PDF document: ${err.message}` });
    }
});

// Catch-all route to serve kiosk terminal by default
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// THIS PART MUST REMAIN AT THE VERY BOTTOM TO START THE SERVER
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await seedAdmin();
});