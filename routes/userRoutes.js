const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const authMiddleware = require('../middleware/authMiddleware'); // Your JWT protection middleware

router.get('/', authMiddleware, userController.getAllUsers);
router.put('/:id', authMiddleware, userController.updateUser);   // UPDATE ROUTE
router.delete('/:id', authMiddleware, userController.deleteUser); // DELETE ROUTE
router.post('/register', userController.registerUser);

module.exports = router;