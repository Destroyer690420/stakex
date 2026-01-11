const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');

const DAILY_BONUS_AMOUNT = 100;
const BONUS_COOLDOWN_HOURS = 24;

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
router.get('/balance', protect, async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('cash, stats')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            cash: parseFloat(user.cash),
            stats: user.stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get wallet balance'
        });
    }
});

// @desc    Get transaction history
// @route   GET /api/wallet/history
router.get('/history', protect, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const { data: transactions, error, count } = await supabaseAdmin
            .from('transactions')
            .select('*', { count: 'exact' })
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            transactions,
            pagination: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get transactions'
        });
    }
});

// @desc    Create a transaction (bet, win, loss)
// @route   POST /api/wallet/transaction
router.post('/transaction', protect, async (req, res) => {
    try {
        const { amount, type } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid positive amount'
            });
        }

        if (!['bet', 'win', 'loss', 'credit', 'debit'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid transaction type. Use: bet, win, loss, credit, or debit'
            });
        }

        // Map types to internal types
        const typeMap = {
            'bet': 'game_loss',
            'win': 'game_win',
            'loss': 'game_loss',
            'credit': 'credit',
            'debit': 'debit'
        };

        const { data, error } = await supabaseAdmin.rpc('process_transaction', {
            p_user_id: req.user.id,
            p_type: typeMap[type],
            p_amount: amount,
            p_description: `${type.charAt(0).toUpperCase() + type.slice(1)}: $${amount}`
        });

        if (error) {
            if (error.message.includes('Insufficient balance')) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient cash balance'
                });
            }
            throw error;
        }

        res.json({
            success: true,
            message: `Transaction successful: ${type} $${amount}`,
            cash: parseFloat(data[0].new_balance),
            transaction: { id: data[0].transaction_id }
        });
    } catch (error) {
        console.error('Transaction error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Transaction failed'
        });
    }
});

// @desc    Claim daily bonus
// @route   GET /api/wallet/claimbonus
router.get('/claimbonus', protect, async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin.rpc('claim_daily_bonus', {
            p_user_id: req.user.id,
            p_bonus_amount: DAILY_BONUS_AMOUNT,
            p_cooldown_hours: BONUS_COOLDOWN_HOURS
        });

        if (error) throw error;

        const result = data[0];

        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message
            });
        }

        res.json({
            success: true,
            message: `🎁 ${result.message}`,
            bonusAmount: DAILY_BONUS_AMOUNT,
            cash: parseFloat(result.new_balance),
            transaction: { id: result.transaction_id }
        });
    } catch (error) {
        console.error('Claim bonus error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to claim bonus'
        });
    }
});

// @desc    Check bonus status
// @route   GET /api/wallet/bonusstatus
router.get('/bonusstatus', protect, async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('last_bonus_claim')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        const now = new Date();
        let canClaim = false;
        let hoursUntilNextBonus = 0;

        if (!user.last_bonus_claim) {
            canClaim = true;
        } else {
            const lastClaim = new Date(user.last_bonus_claim);
            const hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
            if (hoursSinceLastClaim >= BONUS_COOLDOWN_HOURS) {
                canClaim = true;
            } else {
                hoursUntilNextBonus = Math.ceil(BONUS_COOLDOWN_HOURS - hoursSinceLastClaim);
            }
        }

        res.json({
            success: true,
            canClaim,
            bonusAmount: DAILY_BONUS_AMOUNT,
            hoursUntilNextBonus,
            lastClaimed: user.last_bonus_claim
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to check bonus status'
        });
    }
});

module.exports = router;
