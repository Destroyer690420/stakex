const express = require('express');
const router = express.Router();
const {
    getUsers,
    getUser,
    assignCredits,
    deductCredits,
    toggleUserStatus,
    getStats
} = require('../controllers/adminController');
const { protect, adminOnly } = require('../middleware/auth');

// All admin routes require authentication and admin role
router.use(protect);
router.use(adminOnly);

router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/users/:id', getUser);
router.post('/users/:id/credits', assignCredits);
router.post('/users/:id/deduct', deductCredits);
router.put('/users/:id/status', toggleUserStatus);

module.exports = router;
