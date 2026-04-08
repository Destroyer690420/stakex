/**
 * IPL BETTING ROUTES
 * ==================
 * POST /api/bet/ipl          – Place an IPL bet
 * GET  /api/bet/ipl/active   – Get user's active bets
 * GET  /api/bet/ipl/history  – Get user's bet history
 * GET  /api/bet/ipl/matches  – Get current live/upcoming matches (HTTP fallback)
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin } = require('../config/supabase');
const { protect } = require('../middleware/auth');
const { getActiveMatches, IPL_TEAMS } = require('../services/iplScraper');

// ============================================
// POST /api/bet/ipl  –  Place a Bet
// ============================================
router.post('/ipl', protect, async (req, res) => {
    try {
        const { matchId, matchTitle, selectedTeam, betAmount, currentOdds } = req.body;

        // --- Validation ---
        if (!matchId || !selectedTeam || !betAmount || !currentOdds) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: matchId, selectedTeam, betAmount, currentOdds'
            });
        }

        const amount = parseFloat(betAmount);
        if (isNaN(amount) || amount < 10 || amount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Bet must be between $10 and $10,000'
            });
        }

        const odds = parseFloat(currentOdds);
        if (isNaN(odds) || odds < 1.10 || odds > 6.50) {
            return res.status(400).json({
                success: false,
                message: 'Invalid odds value'
            });
        }

        // Validate team code
        if (!IPL_TEAMS[selectedTeam]) {
            return res.status(400).json({
                success: false,
                message: 'Invalid team selection'
            });
        }

        // --- Check betting is still open ---
        // (We trust the client state here but the frontend also enforces this)
        // In a production system you'd re-check the live match status server-side

        // --- Place bet atomically via RPC ---
        const { data, error } = await supabaseAdmin.rpc('place_ipl_bet', {
            p_user_id: req.user.id,
            p_match_id: matchId,
            p_match_title: matchTitle || `${selectedTeam} match`,
            p_selected_team: selectedTeam,
            p_bet_amount: amount,
            p_odds: odds
        });

        if (error) {
            console.error('[IPL Route] RPC error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to place bet'
            });
        }

        if (!data || !data.success) {
            return res.status(400).json({
                success: false,
                message: (data && data.error) || 'Bet placement failed'
            });
        }

        console.log(`🏏 [IPL Bet] User ${req.user.id} bet $${amount} on ${selectedTeam} at ${odds}x`);

        res.json({
            success: true,
            bet: {
                id: data.bet_id,
                matchId,
                selectedTeam,
                betAmount: amount,
                odds,
                potentialPayout: data.potential_payout
            },
            newBalance: data.new_balance
        });
    } catch (err) {
        console.error('[IPL Route] Place bet error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error placing bet'
        });
    }
});

// ============================================
// GET /api/bet/ipl/active  –  User's Active Bets
// ============================================
router.get('/ipl/active', protect, async (req, res) => {
    try {
        const { data: bets, error } = await supabaseAdmin
            .from('ipl_bets')
            .select('*')
            .eq('user_id', req.user.id)
            .eq('status', 'pending')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ success: true, bets: bets || [] });
    } catch (err) {
        console.error('[IPL Route] Active bets error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch active bets' });
    }
});

// ============================================
// GET /api/bet/ipl/history  –  User's Bet History
// ============================================
router.get('/ipl/history', protect, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const { data: bets, error, count } = await supabaseAdmin
            .from('ipl_bets')
            .select('*', { count: 'exact' })
            .eq('user_id', req.user.id)
            .in('status', ['won', 'lost', 'refunded'])
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            bets: bets || [],
            pagination: {
                page, limit,
                total: count,
                pages: Math.ceil((count || 0) / limit)
            }
        });
    } catch (err) {
        console.error('[IPL Route] History error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch bet history' });
    }
});

// ============================================
// GET /api/bet/ipl/matches  –  Current Matches (HTTP fallback)
// ============================================
router.get('/ipl/matches', protect, async (req, res) => {
    try {
        const matchData = await getActiveMatches();
        res.json({ success: true, ...matchData });
    } catch (err) {
        console.error('[IPL Route] Matches error:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch match data' });
    }
});

module.exports = router;
