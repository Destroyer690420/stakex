const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');

const DAILY_BONUS_AMOUNT = 100;
const BONUS_COOLDOWN_HOURS = 24;

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
router.get('/balance', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({
            success: true,
            cash: user.cash,
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
        const skip = (page - 1) * limit;

        const transactions = await Transaction.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Transaction.countDocuments({ userId: req.user.id });

        res.json({
            success: true,
            transactions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
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
        const user = await User.findById(req.user.id);

        // Validate input
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

        let newCash = user.cash;

        // Process based on type
        if (['bet', 'loss', 'debit'].includes(type)) {
            // Subtract from balance
            if (user.cash < amount) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient cash balance'
                });
            }
            newCash -= amount;

            if (type === 'loss') {
                user.stats.lifetimeLosses += amount;
                user.stats.losses += 1;
            }
        } else if (['win', 'credit'].includes(type)) {
            // Add to balance
            newCash += amount;

            if (type === 'win') {
                user.stats.lifetimeEarnings += amount;
                user.stats.wins += 1;
                if (amount > user.stats.biggestWin) {
                    user.stats.biggestWin = amount;
                }
            }
        }

        // Update user cash
        user.cash = newCash;
        await user.save();

        // Create transaction record
        const transaction = await Transaction.create({
            userId: req.user.id,
            type,
            amount,
            balanceAfter: newCash,
            description: `${type.charAt(0).toUpperCase() + type.slice(1)}: $${amount}`
        });

        res.json({
            success: true,
            message: `Transaction successful: ${type} $${amount}`,
            cash: newCash,
            transaction
        });
    } catch (error) {
        console.error('Transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Transaction failed',
            error: error.message
        });
    }
});

// @desc    Claim daily bonus
// @route   GET /api/wallet/claimbonus
router.get('/claimbonus', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        // Check if bonus is available
        const now = new Date();
        let canClaim = false;
        let hoursUntilNextBonus = 0;

        if (!user.lastBonusClaim) {
            // Never claimed before
            canClaim = true;
        } else {
            const hoursSinceLastClaim = (now - user.lastBonusClaim) / (1000 * 60 * 60);
            if (hoursSinceLastClaim >= BONUS_COOLDOWN_HOURS) {
                canClaim = true;
            } else {
                hoursUntilNextBonus = Math.ceil(BONUS_COOLDOWN_HOURS - hoursSinceLastClaim);
            }
        }

        if (!canClaim) {
            return res.status(400).json({
                success: false,
                message: `Daily bonus already claimed. Come back in ${hoursUntilNextBonus} hour(s)!`,
                hoursUntilNextBonus
            });
        }

        // Grant the bonus
        const newCash = user.cash + DAILY_BONUS_AMOUNT;
        user.cash = newCash;
        user.lastBonusClaim = now;
        await user.save();

        // Create transaction record
        const transaction = await Transaction.create({
            userId: req.user.id,
            type: 'bonus',
            amount: DAILY_BONUS_AMOUNT,
            balanceAfter: newCash,
            description: 'Daily login bonus claimed!'
        });

        res.json({
            success: true,
            message: `🎁 Daily bonus of $${DAILY_BONUS_AMOUNT} claimed!`,
            bonusAmount: DAILY_BONUS_AMOUNT,
            cash: newCash,
            transaction
        });
    } catch (error) {
        console.error('Claim bonus error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to claim bonus'
        });
    }
});

// @desc    Check bonus status (is bonus available?)
// @route   GET /api/wallet/bonusstatus
router.get('/bonusstatus', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const now = new Date();

        let canClaim = false;
        let hoursUntilNextBonus = 0;

        if (!user.lastBonusClaim) {
            canClaim = true;
        } else {
            const hoursSinceLastClaim = (now - user.lastBonusClaim) / (1000 * 60 * 60);
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
            lastClaimed: user.lastBonusClaim
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to check bonus status'
        });
    }
});

module.exports = router;
