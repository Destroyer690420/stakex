const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');
const { processTransaction } = require('../controllers/walletController');
const slotsGame = require('../services/slotsGame');

// @desc    Play slots
// @route   POST /api/games/slots/spin
router.post('/slots/spin', protect, async (req, res) => {
    try {
        const { betAmount } = req.body;

        // Validate bet
        if (!betAmount || betAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid bet amount'
            });
        }

        if (betAmount < 10 || betAmount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Bet must be between $10 and $10,000'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('slots_spin', {
            p_user_id: req.user.id,
            p_bet_amount: betAmount
        });

        if (error) {
            console.error('Slots RPC error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to spin slots'
            });
        }

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Spin failed'
            });
        }

        res.json({
            success: true,
            result: {
                symbols: data.symbols,
                won: data.won,
                multiplier: parseFloat(data.multiplier),
                betAmount: parseFloat(data.betAmount),
                payout: parseFloat(data.winnings)
            },
            newCash: parseFloat(data.newBalance)
        });
    } catch (error) {
        console.error('Slots error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Get slots paytable
// @route   GET /api/games/slots/paytable
router.get('/slots/paytable', (req, res) => {
    res.json({
        success: true,
        paytable: slotsGame.PAYTABLE,
        symbols: slotsGame.SYMBOLS,
        minBet: 10,
        maxBet: 10000
    });
});

module.exports = router;
