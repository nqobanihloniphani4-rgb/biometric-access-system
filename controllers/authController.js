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

// Reset Admin Password securely
exports.resetPassword = async (req, res) => {
  const { secretKey, newPassword } = req.body;
  
  // Verify against a secret reset key in your environment variables
  if (secretKey !== process.env.RESET_SECRET) {
    return res.status(403).json({ success: false, error: 'Unauthorized reset attempt' });
  }

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    const result = await pool.query(
      'UPDATE admin_users SET password_hash = $1 WHERE username = $2 RETURNING username',
      [hashedPassword, 'admin']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    res.json({ success: true, message: 'Admin password successfully updated!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};