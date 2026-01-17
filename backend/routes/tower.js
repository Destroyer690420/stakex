const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');

// @desc    Start a new Tower game
// @route   POST /api/games/tower/start
router.post('/start', protect, async (req, res) => {
    try {
        const { betAmount, difficulty } = req.body;

        // Validate inputs
        if (!betAmount || betAmount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum bet is $10'
            });
        }

        if (!difficulty || !['easy', 'medium', 'hard'].includes(difficulty)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid difficulty. Choose: easy, medium, or hard'
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
        const { data, error } = await supabaseAdmin.rpc('fn_start_tower', {
            p_user_id: req.user.id,
            p_bet_amount: betAmount,
            p_difficulty: difficulty
        });

        if (error) {
            console.error('Tower start error:', error);
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
            difficulty: difficulty,
            betAmount: parseFloat(betAmount),
            currentRow: data.currentRow,
            currentMultiplier: parseFloat(data.currentMultiplier),
            nextMultiplier: parseFloat(data.nextMultiplier),
            newBalance: parseFloat(data.newBalance)
        });

    } catch (error) {
        console.error('Tower start error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Climb tower (select a tile)
// @route   POST /api/games/tower/climb
router.post('/climb', protect, async (req, res) => {
    try {
        const { gameId, selectedColIndex } = req.body;

        // Validate inputs
        if (!gameId) {
            return res.status(400).json({
                success: false,
                message: 'Game ID is required'
            });
        }

        if (selectedColIndex === undefined || selectedColIndex < 0 || selectedColIndex > 4) {
            return res.status(400).json({
                success: false,
                message: 'Invalid column index (must be 0-4)'
            });
        }

        // Call the atomic RPC function
        const { data, error } = await supabaseAdmin.rpc('fn_climb_tower', {
            p_game_id: gameId,
            p_user_id: req.user.id,
            p_selected_col_index: selectedColIndex
        });

        if (error) {
            console.error('Tower climb error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to climb tower'
            });
        }

        if (!data.success) {
            return res.status(400).json({
                success: false,
                message: data.error || 'Failed to climb tower'
            });
        }

        // Parse response based on result
        const response = {
            success: true,
            result: data.result
        };

        if (data.result === 'boom') {
            // Hit a mine
            response.minePositions = data.minePositions;
        } else if (data.result === 'safe') {
            // Safe tile, continue climbing
            response.currentRow = data.currentRow;
            response.currentMultiplier = parseFloat(data.currentMultiplier);
            response.nextMultiplier = parseFloat(data.nextMultiplier);
        } else if (data.result === 'cashout') {
            // Completed all rows, auto cashout
            response.multiplier = parseFloat(data.multiplier);
            response.payout = parseFloat(data.payout);
            response.newBalance = parseFloat(data.newBalance);
            response.minePositions = data.minePositions;
        }

        res.json(response);

    } catch (error) {
        console.error('Tower climb error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Cash out from active game
// @route   POST /api/games/tower/cashout
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
        const { data, error } = await supabaseAdmin.rpc('fn_cashout_tower', {
            p_game_id: gameId,
            p_user_id: req.user.id
        });

        if (error) {
            console.error('Tower cashout error:', error);
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
            payout: parseFloat(data.payout),
            multiplier: parseFloat(data.multiplier),
            rowsCompleted: data.rowsCompleted,
            newBalance: parseFloat(data.newBalance),
            minePositions: data.minePositions
        });

    } catch (error) {
        console.error('Tower cashout error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Game error occurred'
        });
    }
});

// @desc    Get active game (if any)
// @route   GET /api/games/tower/active
router.get('/active', protect, async (req, res) => {
    try {
        // Query for active tower session
        const { data: session, error } = await supabaseAdmin
            .from('tower_sessions')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (error || !session) {
            return res.json({
                success: true,
                hasActiveGame: false
            });
        }

        // Calculate current and next multipliers
        const { data: currentMult } = await supabaseAdmin.rpc('get_tower_multiplier', {
            p_row: session.current_row > 0 ? session.current_row - 1 : 0,
            p_difficulty: session.difficulty
        });

        const { data: nextMult } = await supabaseAdmin.rpc('get_tower_multiplier', {
            p_row: session.current_row,
            p_difficulty: session.difficulty
        });

        res.json({
            success: true,
            hasActiveGame: true,
            gameId: session.id,
            betAmount: parseFloat(session.bet_amount),
            difficulty: session.difficulty,
            currentRow: session.current_row,
            currentMultiplier: parseFloat(currentMult || 1.0),
            nextMultiplier: parseFloat(nextMult || 1.21),
            gridState: session.grid_state
        });

    } catch (error) {
        console.error('Tower get active error:', error);
        res.json({
            success: true,
            hasActiveGame: false
        });
    }
});

module.exports = router;
