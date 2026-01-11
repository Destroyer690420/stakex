const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');

// Roulette number colors
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

const getColor = (number) => {
    if (number === 0) return 'green';
    return RED_NUMBERS.includes(number) ? 'red' : 'black';
};

// Valid bet types
const VALID_BET_TYPES = [
    'straight', 'split', 'street', 'corner', 'line',
    'red', 'black', 'odd', 'even', 'low', 'high',
    'dozen1', 'dozen2', 'dozen3', 'column1', 'column2', 'column3'
];

// @desc    Spin the roulette wheel
// @route   POST /api/games/roulette/spin
router.post('/spin', protect, async (req, res) => {
    try {
        const { bets } = req.body;

        // Validate bets array
        if (!bets || !Array.isArray(bets) || bets.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please place at least one bet'
            });
        }

        // Validate each bet
        let totalBet = 0;
        for (const bet of bets) {
            if (!bet.type || !VALID_BET_TYPES.includes(bet.type)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid bet type: ${bet.type}`
                });
            }
            if (!bet.amount || bet.amount <= 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Bet amount must be greater than 0'
                });
            }
            totalBet += bet.amount;
        }

        // Check user has enough balance
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('cash')
            .eq('id', req.user.id)
            .single();

        if (parseFloat(user.cash) < totalBet) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('roulette_spin', {
            p_user_id: req.user.id,
            p_bets: bets
        });

        if (error) {
            console.error('Roulette spin error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Spin failed'
            });
        }

        // Check RPC result
        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Spin failed'
            });
        }

        res.json({
            success: true,
            result: data.result,
            color: data.color,
            totalBet: parseFloat(data.totalBet),
            totalWin: parseFloat(data.totalWin),
            netResult: parseFloat(data.netResult),
            newBalance: parseFloat(data.newBalance)
        });

    } catch (error) {
        console.error('Roulette error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Get roulette history (last 20 spins)
// @route   GET /api/games/roulette/history
router.get('/history', async (req, res) => {
    try {
        const { data: history, error } = await supabaseAdmin
            .from('roulette_history')
            .select('id, result, color, created_at')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        res.json({
            success: true,
            history: history.map(h => ({
                id: h.id,
                result: h.result,
                color: h.color,
                timestamp: h.created_at
            }))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get history'
        });
    }
});

// @desc    Get roulette stats for user
// @route   GET /api/games/roulette/stats
router.get('/stats', protect, async (req, res) => {
    try {
        const { data: history, error } = await supabaseAdmin
            .from('roulette_history')
            .select('total_bet, total_win')
            .eq('user_id', req.user.id);

        if (error) throw error;

        const totalSpins = history.length;
        const totalBet = history.reduce((sum, h) => sum + parseFloat(h.total_bet), 0);
        const totalWin = history.reduce((sum, h) => sum + parseFloat(h.total_win), 0);

        res.json({
            success: true,
            stats: {
                totalSpins,
                totalBet,
                totalWin,
                netResult: totalWin - totalBet
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get stats'
        });
    }
});

module.exports = router;
