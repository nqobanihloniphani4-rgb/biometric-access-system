const express = require('express');
const cors = require('cors');
const path = require('path');
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
app.use('/api/events', accessRoutes);

// NEW: Handle user enrollment and fingerprint slot assignment (Fixes 404 Error)
app.post('/api/enroll', async (req, res) => {
    try {
        const { full_name, id_number, employee_code, contact_number, email_address, department, user_role, fingerprint_slot } = req.body;
        
        console.log("Enrollment request received for:", full_name, "Slot:", fingerprint_slot);

        const queryText = `
            INSERT INTO users (full_name, id_number, employee_code, contact_number, email_address, department, user_role, fingerprint_slot, created_at)
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