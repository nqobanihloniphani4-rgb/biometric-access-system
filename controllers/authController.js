const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Admin Login
exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const admin = result.rows[0];
    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ success: true, token, role: admin.role, username: admin.username });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// Seed initial admin user if none exists
exports.seedAdmin = async () => {
  try {
    const check = await pool.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
    if (check.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO admin_users (username, password_hash, role) VALUES ($1, $2, $3)',
        ['admin', hashedPassword, 'ADMIN']
      );
      console.log('Default admin created: Username = admin | Password = admin123');
    }
  } catch (err) {
    console.error('Error seeding admin user:', err.message);
  }
};