const express = require('express');
const router = express.Router();
const accessController = require('../controllers/accessController');
const verifyToken = require('../middleware/authMiddleware');

// Hardware / Simulator endpoints (Public)
router.post('/access', accessController.logAccess);
router.post('/duress', accessController.triggerDuress);
router.get('/logs', verifyToken, accessController.getAttendanceLogs); // Attendance Logs dashboard data
router.get('/latest', accessController.getLatestLogs); // Public live feed for the kiosk terminal (index.html)
router.get('/enroll/poll', accessController.getPendingEnrollment); // Updated for ESP32 polling endpoint

// Admin / Security Dashboard endpoints (Protected)
router.get('/audit/:identifier', verifyToken, accessController.getEmployeeAuditHistory);
router.get('/alerts', verifyToken, accessController.getActiveAlerts);
router.post('/enroll-slot', verifyToken, accessController.enrollSlot);

module.exports = router;