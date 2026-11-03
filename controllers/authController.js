const pool = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Configure Nodemailer transporter (using Gmail / SMTP)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Admin Login
exports.login = async (req, res) => {
  const { username, password } = req.body; // Note: 'username' here holds the email entered in the login form
  try {
    // Query the main 'users' table instead of 'admin_users'
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND role = $2', [username, 'ADMIN']);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const admin = result.rows[0];
    
    // Check if password_hash exists and matches
    if (!admin.password_hash) {
      return res.status(401).json({ success: false, error: 'Password not set for this admin account.' });
    }

    const isMatch = await bcrypt.compare(password, admin.password_hash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.email, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ success: true, token, role: admin.role, username: admin.email });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};
// Seed initial admin user if none exists
exports.seedAdmin = async () => {
  try {
    const check = await db.query('SELECT * FROM admin_users WHERE username = $1', ['admin']);
    if (check.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await db.query(
        'INSERT INTO admin_users (username, password_hash, role) VALUES ($1, $2, $3)',
        ['admin', hashedPassword, 'ADMIN']
      );
      console.log('Default admin created: Username = admin | Password = admin123');
    }
  } catch (err) {
    console.error('Error seeding admin user:', err.message);
  }
};

// 1. Request Password Reset (Sends Email with Token Link)
// 1. Request Password Reset (Sends Email with Dynamic Link)
exports.forgotPassword = async (req, res) => {
  const { username } = req.body;

  try {
    const result = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin user not found' });
    }

    // Generate secure random token and expiration (1 hour)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 3600000);

    // Save token and expiry to database
    await pool.query(
      'UPDATE admin_users SET reset_token = $1, reset_token_expires = $2 WHERE username = $3',
      [resetToken, tokenExpires, username]
    );

    // Dynamically detect if running locally or on Render (e.g., your-app.onrender.com)
    const protocol = req.protocol;
    const host = req.get('host');
    const resetUrl = `${protocol}://${host}/reset-password.html?token=${resetToken}`;

    // Send email
    await transporter.sendMail({
      from: '"Biometric Security Portal" <no-reply@securityportal.com>',
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: 'Password Reset Request',
      html: `
        <h3>Security Portal Password Reset</h3>
        <p>You requested a password reset for admin username: <b>${username}</b></p>
        <p>Click the link below to reset your password. This link is valid for 1 hour:</p>
        <a href="${resetUrl}" target="_blank">${resetUrl}</a>
      `
    });

    res.json({ success: true, message: 'Password reset link sent to your email successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// 2. Reset Password via Token
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ success: false, error: 'Password must be at least 8 characters long' });
  }

  try {
    // Find admin with valid unexpired token
    const userRes = await pool.query(
      'SELECT * FROM admin_users WHERE reset_token = $1 AND reset_token_expires > NOW()',
      [token]
    );

    if (userRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
    }

    const admin = userRes.rows[0];
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear token fields
    await pool.query(
      'UPDATE admin_users SET password_hash = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, admin.id]
    );

    res.json({ success: true, message: 'Password successfully updated! You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

