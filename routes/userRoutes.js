const express = require('express');
const router = express.Router();
const accessController = require('../controllers/accessController'); // Or userController depending on your setup
const verifyToken = require('../middleware/authMiddleware');

// ADD THIS MISSING POST ROUTE FOR REGISTRATION:
router.post('/', verifyToken, accessController.createUser); // (Make sure the controller function matches your project, e.g., createUser or registerUser)

router.get('/', verifyToken, accessController.getAllUsers);
router.put('/:id', verifyToken, accessController.updateUser);
router.delete('/:id', verifyToken, accessController.deleteUser);
router.get('/export/csv', verifyToken, accessController.exportUsersCSV);

module.exports = router;