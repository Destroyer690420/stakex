const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');

// @desc    Start a new Mines game
// @route   POST /api/games/mines/start
router.post('/start', protect, async (req, res) => {
    try {
        const { betAmount, minesCount } = req.body;

        // Validate inputs
        if (!betAmount || betAmount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum bet is 10 cash'
            });
        }

        if (!minesCount || minesCount < 1 || minesCount > 24) {
            return res.status(400).json({
                success: false,
                message: 'Mines count must be between 1 and 24'
            });
        }

        // Check user has enough balance
        const { data: user } = await supabaseAdmin
            .from('users')
            .select('cash')
            .eq('id', req.user.id)
            .single();

        if (parseFloat(user.cash) < betAmount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('mines_start', {
            p_user_id: req.user.id,
            p_bet_amount: betAmount,
            p_mines_count: minesCount
        });

        if (error) {
            console.error('Mines start error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to start game'
            });
        }

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Failed to start game'
            });
        }

        res.json({
            success: true,
            gameId: data.gameId,
            betAmount: parseFloat(data.betAmount),
            minesCount: data.minesCount,
            newBalance: parseFloat(data.newBalance),
            currentMultiplier: parseFloat(data.currentMultiplier),
            nextMultiplier: parseFloat(data.nextMultiplier)
        });

    } catch (error) {
        console.error('Mines start error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Reveal a tile
// @route   POST /api/games/mines/reveal
router.post('/reveal', protect, async (req, res) => {
    try {
        const { gameId, tileIndex } = req.body;

        // Validate inputs
        if (!gameId) {
            return res.status(400).json({
                success: false,
                message: 'Game ID is required'
            });
        }

        if (tileIndex === undefined || tileIndex < 0 || tileIndex > 24) {
            return res.status(400).json({
                success: false,
                message: 'Invalid tile index (must be 0-24)'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('mines_reveal', {
            p_user_id: req.user.id,
            p_game_id: gameId,
            p_tile_index: tileIndex
        });

        if (error) {
            console.error('Mines reveal error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to reveal tile'
            });
        }

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Failed to reveal tile'
            });
        }

        // Parse response based on result
        const response = {
            success: true,
            result: data.result,
            tileIndex: data.tileIndex,
            gameOver: data.gameOver
        };

        if (data.result === 'mine') {
            response.minePositions = data.minePositions;
        } else if (data.result === 'safe') {
            response.revealedCount = data.revealedCount;
            response.currentMultiplier = parseFloat(data.currentMultiplier);
            response.nextMultiplier = parseFloat(data.nextMultiplier);
            response.potentialWin = parseFloat(data.potentialWin);
        } else if (data.result === 'cashout') {
            // Auto-cashout when all safe tiles revealed
            response.winnings = parseFloat(data.winnings);
            response.multiplier = parseFloat(data.multiplier);
            response.newBalance = parseFloat(data.newBalance);
            response.minePositions = data.minePositions;
        }

        res.json(response);

    } catch (error) {
        console.error('Mines reveal error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Cash out from active game
// @route   POST /api/games/mines/cashout
router.post('/cashout', protect, async (req, res) => {
    try {
        const { gameId } = req.body;

        if (!gameId) {
            return res.status(400).json({
                success: false,
                message: 'Game ID is required'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('mines_cashout', {
            p_user_id: req.user.id,
            p_game_id: gameId
        });

        if (error) {
            console.error('Mines cashout error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to cash out'
            });
        }

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Failed to cash out'
            });
        }

        res.json({
            success: true,
            winnings: parseFloat(data.winnings),
            multiplier: parseFloat(data.multiplier),
            revealedCount: data.revealedCount,
            newBalance: parseFloat(data.newBalance),
            minePositions: data.minePositions
        });

    } catch (error) {
        console.error('Mines cashout error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Get active game (if any)
// @route   GET /api/games/mines/active
router.get('/active', protect, async (req, res) => {
    try {
        // Call the RPC function
        const { data, error } = await supabaseAdmin.rpc('mines_get_active', {
            p_user_id: req.user.id
        });

        if (error) {
            console.error('Mines get active error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get active game'
            });
        }

        if (!data.hasActiveGame) {
            return res.json({
                success: true,
                hasActiveGame: false
            });
        }

        res.json({
            success: true,
            hasActiveGame: true,
            gameId: data.gameId,
            betAmount: parseFloat(data.betAmount),
            minesCount: data.minesCount,
            revealedTiles: data.revealedTiles,
            currentMultiplier: parseFloat(data.currentMultiplier),
            nextMultiplier: parseFloat(data.nextMultiplier),
            potentialWin: parseFloat(data.potentialWin)
        });

    } catch (error) {
        console.error('Mines get active error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

module.exports = router;
