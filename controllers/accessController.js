const pool = require('../config/db');
let pendingEnrollmentSlot = null;
const { Parser } = require('json2csv');
const bcrypt = require('bcrypt');

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

// Register / Create New User
exports.createUser = async (req, res) => {
    const { 
        full_name, 
        id_number, 
        employee_code, 
        contact_number, 
        email, 
        department, 
        role, 
        fingerprint_slot_id, 
        exit_slot_id, 
        duress_slot_id,
        password 
    } = req.body;

    try {
        let hashedPassword = null;
        if (role === 'ADMIN' && password) {
            hashedPassword = await bcrypt.hash(password, 10);
        }

        const query = `
            INSERT INTO users (full_name, id_number, employee_code, contact_number, email, department, role, fingerprint_slot_id, exit_slot_id, duress_slot_id, password_hash)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *;
        `;
        const values = [
            full_name, 
            id_number || null, 
            employee_code, 
            contact_number || null, 
            email || null, 
            department || null, 
            role || 'EMPLOYEE', 
            fingerprint_slot_id ? parseInt(fingerprint_slot_id) : null, 
            exit_slot_id ? parseInt(exit_slot_id) : null, 
            duress_slot_id ? parseInt(duress_slot_id) : null,
            hashedPassword
        ];

        const result = await pool.query(query, values);
        res.status(201).json({ 
            success: true, 
            message: 'User registered successfully', 
            user: result.rows[0] 
        });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Log Standard Access (Clock-In / Clock-Out)
exports.logAccess = async (req, res) => {
    const { fingerprint_slot_id, employee_code, event_type = 'ENTRY' } = req.body;

    try {
        const parsedSlotId = fingerprint_slot_id ? parseInt(fingerprint_slot_id) : null;

        let userQuery = `
            SELECT id, full_name, employee_code, role, fingerprint_slot_id, exit_slot_id, duress_slot_id 
            FROM users 
            WHERE fingerprint_slot_id = $1 OR exit_slot_id = $1 OR duress_slot_id = $1
        `;
        let queryParam = parsedSlotId;

        if (!parsedSlotId && employee_code) {
            userQuery = `SELECT id, full_name, employee_code, role, fingerprint_slot_id, exit_slot_id, duress_slot_id FROM users WHERE employee_code = $1`;
            queryParam = employee_code;
        }

        const userResult = await pool.query(userQuery, [queryParam]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Employee not found.' });
        }

        const user = userResult.rows[0];
        let calculatedEventType = event_type;

        if (parsedSlotId) {
            const scannedSlot = parsedSlotId;

            if (scannedSlot === user.exit_slot_id) {
                calculatedEventType = 'EXIT';
            } else if (scannedSlot === user.duress_slot_id) {
                await pool.query(
                    'INSERT INTO attendance_logs (user_id, event_type) VALUES ($1, $2)',
                    [user.id, 'DURESS_OPEN']
                );
                await pool.query(
                    'INSERT INTO emergency_alerts (user_id, alert_type) VALUES ($1, $2)',
                    [user.id, 'SILENT_DURESS']
                );
                return res.json({ 
                    success: true, 
                    message: 'Duress alert triggered covertly',
                    user: {
                        full_name: user.full_name,
                        role: user.role,
                        employee_code: user.employee_code
                    }
                });
            }
        }

        // Automatic Toggle Logic using South African Time
        if (calculatedEventType === 'ENTRY') {
            const activeSessionQuery = `
                SELECT id FROM attendance_logs al
                WHERE al.user_id = $1 
                AND DATE((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE 
                AND al.event_type = 'ENTRY'
                AND NOT EXISTS (
                    SELECT 1 FROM attendance_logs al_exit
                    WHERE al_exit.user_id = $1 
                    AND DATE((al_exit.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE 
                    AND al_exit.event_type = 'EXIT'
                    AND al_exit.timestamp > al.timestamp
                )
                ORDER BY al.timestamp DESC
                LIMIT 1;
            `;
            const activeResult = await pool.query(activeSessionQuery, [user.id]);

            if (activeResult.rows.length > 0) {
                calculatedEventType = 'EXIT';
            }
        }

        await pool.query(
            'INSERT INTO attendance_logs (user_id, event_type) VALUES ($1, $2)',
            [user.id, calculatedEventType]
        );

        res.json({ 
            success: true, 
            message: `Access (${calculatedEventType}) logged successfully`,
            user: {
                full_name: user.full_name,
                role: user.role,
                employee_code: user.employee_code
            }
        });
    } catch (err) {
        console.error("Log access error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Log Silent Duress
exports.triggerDuress = async (req, res) => {
    const { fingerprint_slot_id, employee_code } = req.body;

    try {
        const parsedSlotId = fingerprint_slot_id ? parseInt(fingerprint_slot_id) : null;

        let userQuery = `
            SELECT id, full_name, employee_code, department FROM users 
            WHERE fingerprint_slot_id = $1 OR exit_slot_id = $1 OR duress_slot_id = $1
        `;
        let queryParam = parsedSlotId;

        if (!parsedSlotId && employee_code) {
            userQuery = 'SELECT id, full_name, employee_code, department FROM users WHERE employee_code = $1';
            queryParam = employee_code;
        }

        const userResult = queryParam ? await pool.query(userQuery, [queryParam]) : { rows: [] };
        
        const user = userResult.rows.length > 0 ? userResult.rows[0] : {
            id: null,
            full_name: 'Unknown / Gate Panic Button',
            employee_code: 'EMERGENCY',
            department: 'Security'
        };

        if (user.id) {
            await pool.query(
                'INSERT INTO attendance_logs (user_id, event_type) VALUES ($1, $2)',
                [user.id, 'DURESS_OPEN']
            );

            await pool.query(
                'INSERT INTO emergency_alerts (user_id, alert_type) VALUES ($1, $2)',
                [user.id, 'SILENT_DURESS']
            );
        } else {
            await pool.query(
                'INSERT INTO emergency_alerts (alert_type, status) VALUES ($1, $2)',
                ['SILENT_DURESS', 'ACTIVE']
            );
        }

        // Send email via Resend over HTTPS (Port 443 - bypasses Render port restrictions)
        try {
            const data = await resend.emails.send({
                from: 'Access Control <onboarding@resend.dev>',
                to: process.env.SECURITY_EMAIL || 'security@yourcompany.com',
                subject: '🚨 URGENT: Silent Duress Alert Triggered at Gate!',
                text: `EMERGENCY ALERT!\n\nA silent duress button was triggered.\n\nEmployee Details:\n- Name: ${user.full_name}\n- Employee Code: ${user.employee_code}\n- Department: ${user.department || 'N/A'}\n\nThe door has been unlocked covertly. Please check security premises immediately.`,
            });
            console.log('Security email sent successfully via Resend:', data);
        } catch (mailErr) {
            console.error('Error sending security email via Resend:', mailErr);
        }

        res.json({ success: true, message: 'Duress alert triggered covertly and security notified' });
    } catch (err) {
        console.error('Trigger Duress Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Get Complete Attendance Logs for Attendance Dashboard (Adjusted to SAST)
exports.getAttendanceLogs = async (req, res) => {
    try {
        const query = `
            SELECT 
                u.id AS user_id,
                u.full_name,
                u.employee_code,
                u.department,
                TO_CHAR((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD') AS log_date,
                MIN(CASE WHEN al.event_type IN ('ENTRY', 'ACCESS') THEN TO_CHAR((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS entry_time,
                MAX(CASE WHEN al.event_type = 'EXIT' THEN TO_CHAR((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS exit_time,
                MAX(CASE WHEN al.event_type = 'DURESS_OPEN' THEN TO_CHAR((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS duress_time
            FROM users u
            LEFT JOIN attendance_logs al ON u.id = al.user_id
            GROUP BY u.id, u.full_name, u.employee_code, u.department, log_date
            ORDER BY log_date DESC, u.full_name ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error("Get attendance logs error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Get Live Terminal Feed (Most recent individual scans for index.html kiosk)
exports.getLatestLogs = async (req, res) => {
    try {
        const query = `
            SELECT 
                al.id,
                al.event_type,
                (EXTRACT(EPOCH FROM al.timestamp) * 1000) AS timestamp_ms,
                TO_CHAR((al.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD HH24:MI:SS') AS formatted_time,
                u.full_name,
                u.employee_code,
                u.department
            FROM attendance_logs al
            JOIN users u ON al.user_id = u.id
            ORDER BY al.timestamp DESC
            LIMIT 5;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        console.error("Get latest logs error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// Individual Employee Audit Report (Adjusted to SAST)
exports.getEmployeeAuditHistory = async (req, res) => {
    const { identifier } = req.params;

    try {
        const userQuery = `
            SELECT id, full_name, employee_code, id_number, department, role, created_at
            FROM users 
            WHERE employee_code = $1 OR id_number = $1 OR CAST(id AS TEXT) = $1
        `;
        const userRes = await pool.query(userQuery, [identifier]);

        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Employee not found.' });
        }

        const user = userRes.rows[0];

        const historyQuery = `
            WITH active_dates AS (
                SELECT DISTINCT DATE((timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg') AS log_date
                FROM attendance_logs
            )
            SELECT 
                TO_CHAR(d.log_date, 'YYYY-MM-DD') AS log_date,
                MIN(CASE WHEN a.event_type = 'ENTRY' THEN TO_CHAR((a.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS entry_time,
                MAX(CASE WHEN a.event_type = 'EXIT' THEN TO_CHAR((a.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS exit_time,
                MAX(CASE WHEN a.event_type = 'DURESS_OPEN' THEN TO_CHAR((a.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI:SS') END) AS duress_time
            FROM active_dates d
            LEFT JOIN attendance_logs a 
                ON a.user_id = $1 
               AND DATE((a.timestamp AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg') = d.log_date
            GROUP BY d.log_date
            ORDER BY d.log_date DESC;
        `;

        const historyRes = await pool.query(historyQuery, [user.id]);

        res.json({
            user,
            history: historyRes.rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Get Active Alerts
exports.getActiveAlerts = async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                e.id, 
                e.alert_type, 
                TO_CHAR((e.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Africa/Johannesburg', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, 
                u.full_name, 
                u.employee_code
            FROM emergency_alerts e
            JOIN users u ON e.user_id = u.id
            WHERE e.status = 'ACTIVE'
            ORDER BY e.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Export Registered Users as CSV
exports.exportUsersCSV = async (req, res) => {
    try {
        const query = `
            SELECT id, full_name, employee_code, department, role, created_at 
            FROM users 
            ORDER BY id ASC
        `;
        const result = await pool.query(query);
        
        const fields = ['id', 'full_name', 'employee_code', 'department', 'role', 'created_at'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(result.rows);

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=registered_users.csv');
        return res.status(200).end(csv);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Get All Registered Users
exports.getAllUsers = async (req, res) => {
    try {
        const query = `
            SELECT id, full_name, id_number, employee_code, contact_number, email, department, role, fingerprint_slot_id, created_at 
            FROM users 
            ORDER BY id ASC
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Update User Details
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { full_name, id_number, employee_code, contact_number, email, department } = req.body;

    try {
        const query = `
            UPDATE users 
            SET full_name = $1, id_number = $2, employee_code = $3, contact_number = $4, email = $5, department = $6
            WHERE id = $7
            RETURNING *;
        `;
        const values = [full_name, id_number, employee_code, contact_number, email, department, id];
        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        res.json({ success: true, message: 'User updated successfully', user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Delete User
exports.deleteUser = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING *;', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found.' });
        }

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Triggered by Admin Web Dashboard (Enroll Slot)
exports.enrollSlot = async (req, res) => {
    try {
        const { slot_id } = req.body;
        if (!slot_id) {
            return res.status(400).json({ success: false, error: "Slot ID is required" });
        }

        pendingEnrollmentSlot = parseInt(slot_id);
        console.log(`[HARDWARE ENROLLMENT] Slot #${slot_id} queued for sensor recording.`);
        res.json({ success: true, message: `Enrollment queued for slot ${slot_id}` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Polled continuously by ESP32 over Wi-Fi
exports.getPendingEnrollment = async (req, res) => {
    try {
        if (pendingEnrollmentSlot !== null) {
            const slotToEnroll = pendingEnrollmentSlot;
            pendingEnrollmentSlot = null; // Clear after fetching so it triggers only once
            return res.json({ enroll: true, slot_id: slotToEnroll });
        }
        res.json({ enroll: false });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};