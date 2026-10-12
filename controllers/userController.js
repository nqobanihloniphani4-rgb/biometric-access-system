const db = require('../config/db');

// REGISTER NEW USER / PERSONNEL
exports.registerUser = async (req, res) => {
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
        duress_slot_id 
    } = req.body;

    try {
        const query = `
            INSERT INTO users (
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
                created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING *;
        `;
        const values = [
            full_name, 
            id_number || null, 
            employee_code, 
            contact_number || null, 
            email || null, 
            department, 
            role || 'EMPLOYEE', 
            fingerprint_slot_id ? parseInt(fingerprint_slot_id) : null, 
            exit_slot_id ? parseInt(exit_slot_id) : null, 
            duress_slot_id ? parseInt(duress_slot_id) : null
        ];

        const result = await db.query(query, values);
        res.status(201).json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error('Error registering user:', err);
        res.status(500).json({ success: false, error: err.message });
    }
};

// GET ALL USERS
exports.getAllUsers = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM users ORDER BY fingerprint_slot_id ASC NULLS LAST');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ message: 'Database error fetching users' });
    }
};

// UPDATE USER
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { 
        full_name, 
        id_number, 
        employee_code, 
        contact_number, 
        email, 
        department, 
        exit_slot_id 
    } = req.body;

    try {
        const query = `
            UPDATE users 
            SET full_name = $1, 
                id_number = $2, 
                employee_code = $3, 
                contact_number = $4, 
                email = $5, 
                department = $6,
                exit_slot_id = $7
            WHERE id = $8 
            RETURNING *;
        `;
        const values = [
            full_name, 
            id_number || null, 
            employee_code, 
            contact_number || null, 
            email || null, 
            department, 
            exit_slot_id ? parseInt(exit_slot_id) : null,
            id
        ];
        
        const result = await db.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User updated successfully', user: result.rows[0] });
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ message: 'Database error updating user' });
    }
};

// DELETE USER
exports.deleteUser = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING *;', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User removed from database successfully' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ message: 'Database error deleting user' });
    }
};