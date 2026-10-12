const express = require('express');
const router = express.Router();
const accessController = require('../controllers/accessController');
const verifyToken = require('../middleware/authMiddleware');

// Hardware / Simulator endpoints (Public)
router.post('/access', accessController.logAccess);
router.post('/duress', accessController.triggerDuress);

// Admin / Security Dashboard endpoints (Protected)
router.get('/logs', verifyToken, accessController.getAttendanceLogs);
router.get('/audit/:identifier', verifyToken, accessController.getEmployeeAuditHistory);
router.get('/alerts', verifyToken, accessController.getActiveAlerts);

module.exports = router;