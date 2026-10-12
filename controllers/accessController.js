const pool = require('../config/db');

// Log Standard Access (Clock-In / Clock-Out)
exports.logAccess = async (req, res) => {
    const { fingerprint_slot_id, employee_code, event_type = 'ENTRY' } = req.body;

    try {
        let userQuery = `
            SELECT id, role, fingerprint_slot_id, exit_slot_id, duress_slot_id 
            FROM users 
            WHERE fingerprint_slot_id = $1 OR exit_slot_id = $1 OR duress_slot_id = $1
        `;
        let queryParam = fingerprint_slot_id;

        if (!fingerprint_slot_id && employee_code) {
            userQuery = `SELECT id, role, fingerprint_slot_id, exit_slot_id, duress_slot_id FROM users WHERE employee_code = $1`;
            queryParam = employee_code;
        }

        const userResult = await pool.query(userQuery, [queryParam]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Employee not found.' });
        }

        const user = userResult.rows[0];
        let calculatedEventType = event_type;

        if (fingerprint_slot_id) {
            const scannedSlot = parseInt(fingerprint_slot_id);

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
                return res.json({ success: true, message: 'Duress alert triggered covertly' });
            }
        }

        await pool.query(
            'INSERT INTO attendance_logs (user_id, event_type) VALUES ($1, $2)',
            [user.id, calculatedEventType]
        );

        res.json({ success: true, message: `Access (${calculatedEventType}) logged successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Log Silent Duress
exports.triggerDuress = async (req, res) => {
    const { fingerprint_slot_id, employee_code } = req.body;

    try {
        let userQuery = `
            SELECT id FROM users 
            WHERE fingerprint_slot_id = $1 OR exit_slot_id = $1 OR duress_slot_id = $1
        `;
        let queryParam = fingerprint_slot_id;

        if (!fingerprint_slot_id && employee_code) {
            userQuery = 'SELECT id FROM users WHERE employee_code = $1';
            queryParam = employee_code;
        }

        const userResult = await pool.query(userQuery, [queryParam]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Employee not found.' });
        }

        const userId = userResult.rows[0].id;

        await pool.query(
            'INSERT INTO attendance_logs (user_id, event_type) VALUES ($1, $2)',
            [userId, 'DURESS_OPEN']
        );

        await pool.query(
            'INSERT INTO emergency_alerts (user_id, alert_type) VALUES ($1, $2)',
            [userId, 'SILENT_DURESS']
        );

        res.json({ success: true, message: 'Duress alert triggered covertly' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Get Complete Attendance Logs Option 2 (Lists ALL users per active date, sorted by User ID ascending)
exports.getAttendanceLogs = async (req, res) => {
    try {
        const query = `
            WITH active_dates AS (
                SELECT DISTINCT DATE(timestamp AT TIME ZONE 'UTC') AS log_date
                FROM attendance_logs
            ),
            user_dates AS (
                SELECT u.id AS user_id, u.full_name, u.employee_code, u.department, d.log_date
                FROM users u
                CROSS JOIN active_dates d
            )
            SELECT 
                ud.user_id,
                ud.full_name,
                ud.employee_code,
                ud.department,
                TO_CHAR(ud.log_date, 'YYYY-MM-DD') AS log_date,
                MIN(CASE WHEN a.event_type = 'ENTRY' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS entry_time,
                MAX(CASE WHEN a.event_type = 'EXIT' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS exit_time,
                MAX(CASE WHEN a.event_type = 'DURESS_OPEN' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS duress_time
            FROM user_dates ud
            LEFT JOIN attendance_logs a 
                ON ud.user_id = a.user_id 
               AND DATE(a.timestamp AT TIME ZONE 'UTC') = ud.log_date
            GROUP BY ud.user_id, ud.full_name, ud.employee_code, ud.department, ud.log_date
            ORDER BY ud.log_date DESC, ud.user_id ASC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

// Individual Employee Audit Report (For Wage Disputes & Promotion Checks)
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
                SELECT DISTINCT DATE(timestamp AT TIME ZONE 'UTC') AS log_date
                FROM attendance_logs
            )
            SELECT 
                TO_CHAR(d.log_date, 'YYYY-MM-DD') AS log_date,
                MIN(CASE WHEN a.event_type = 'ENTRY' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS entry_time,
                MAX(CASE WHEN a.event_type = 'EXIT' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS exit_time,
                MAX(CASE WHEN a.event_type = 'DURESS_OPEN' THEN TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'HH24:MI:SS') END) AS duress_time
            FROM active_dates d
            LEFT JOIN attendance_logs a 
                ON a.user_id = $1 
               AND DATE(a.timestamp AT TIME ZONE 'UTC') = d.log_date
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
                TO_CHAR(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, 
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