const express = require('express');
const router = express.Router();
const { register, login, logout, getMe, refreshToken } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.post('/refresh', refreshToken);
router.get('/me', protect, getMe);

module.exports = router;
