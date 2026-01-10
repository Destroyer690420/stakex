const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const GameSession = require('../models/GameSession');
// Attempting to locate processTransaction. If it was in walletController, we include it. 
// Assuming the previous code layout was correct before deletion.
const { processTransaction } = require('../controllers/walletController');
const slotsGame = require('../services/slotsGame');

router.post('/slots/spin', protect, async (req, res) => {
    try {
        const { betAmount } = req.body;
        const user = await User.findById(req.user.id);

        // Validate bet
        if (!betAmount || betAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid bet amount'
            });
        }

        if (betAmount > user.cash) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance'
            });
        }

        if (betAmount < 10 || betAmount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Bet must be between $10 and $10,000'
            });
        }

        // Spin the slots
        const spinResult = slotsGame.spin(betAmount);

        // Process the bet (deduct)
        await processTransaction(
            req.user.id,
            'game_loss',
            betAmount,
            `Slots bet: $${betAmount}`,
            { gameType: 'slots' }
        );

        // If won, add winnings
        if (spinResult.won) {
            await processTransaction(
                req.user.id,
                'game_win',
                spinResult.payout,
                `Slots win: ${spinResult.multiplier}x multiplier!`,
                { gameType: 'slots' }
            );
        }

        // Update user stats
        user.stats.gamesPlayed += 1;
        if (spinResult.won) {
            user.stats.wins += 1;
        } else {
            user.stats.losses += 1;
        }
        await user.save();

        // Create game session record
        await GameSession.create({
            gameType: 'slots',
            players: [{
                userId: req.user.id,
                username: user.username,
                initialChips: user.cash + betAmount,
                finalChips: spinResult.won ? user.cash + spinResult.payout : user.cash,
                profit: spinResult.netResult
            }],
            status: 'completed',
            result: spinResult,
            bets: [{
                userId: req.user.id,
                amount: betAmount,
                payout: spinResult.payout,
                outcome: spinResult.won ? 'win' : 'loss'
            }],
            endedAt: new Date()
        });

        // Get updated balance
        const updatedUser = await User.findById(req.user.id);

        res.json({
            success: true,
            result: {
                grid: spinResult.grid,
                won: spinResult.won,
                multiplier: spinResult.multiplier,
                winLine: spinResult.winLine,
                betAmount: spinResult.betAmount,
                payout: spinResult.payout
            },
            newCash: updatedUser.cash
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
