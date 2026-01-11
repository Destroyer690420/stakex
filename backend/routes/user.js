const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');

// @desc    Get user profile
// @route   GET /api/users/profile
router.get('/profile', protect, async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('id, username, email, cash, is_admin, avatar, stats, created_at, last_login, last_bonus_claim')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get profile'
        });
    }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
router.put('/profile', protect, async (req, res) => {
    try {
        const { username, avatar } = req.body;
        const updates = { updated_at: new Date().toISOString() };

        if (username && username !== req.user.username) {
            // Check if username is taken
            const { data: existingUser } = await supabaseAdmin
                .from('users')
                .select('username')
                .eq('username', username)
                .single();

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Username already taken'
                });
            }
            updates.username = username;
        }

        if (avatar) {
            updates.avatar = avatar;
        }

        const { data: user, error } = await supabaseAdmin
            .from('users')
            .update(updates)
            .eq('id', req.user.id)
            .select('id, username, email, cash, is_admin, avatar, stats, created_at, last_login')
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
});

// @desc    Get user stats
// @route   GET /api/users/stats
router.get('/stats', protect, async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('stats, cash')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            stats: user.stats,
            cash: parseFloat(user.cash)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get stats'
        });
    }
});

module.exports = router;
