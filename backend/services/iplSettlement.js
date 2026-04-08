/**
 * IPL AUTO-SETTLEMENT SERVICE
 * ============================
 * When a match ends, settles all pending bets:
 *   - Winners get: betAmount × odds_at_placement
 *   - Losers get marked as 'lost'
 * Uses the atomic settle_ipl_bet RPC in Supabase.
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Settle all pending bets for a completed match.
 *
 * @param {string} matchId   – The match identifier (e.g. "demo_173...")
 * @param {string} winnerTeam – Team short code (e.g. "MI", "CSK")
 * @param {object} io        – Socket.io instance for broadcasting
 * @returns {object} – { success, settled, winners, losers }
 */
async function settleMatch(matchId, winnerTeam, io) {
    console.log(`🏏 [IPL Settlement] Settling match ${matchId} | Winner: ${winnerTeam}`);

    try {
        // 1. Get all pending bets for this match
        const { data: bets, error } = await supabaseAdmin
            .from('ipl_bets')
            .select('*')
            .eq('match_id', matchId)
            .eq('status', 'pending');

        if (error) {
            console.error('[IPL Settlement] DB error fetching bets:', error);
            return { success: false, error: error.message };
        }

        if (!bets || bets.length === 0) {
            console.log('[IPL Settlement] No pending bets for this match');
            return { success: true, settled: 0, winners: 0, losers: 0 };
        }

        console.log(`[IPL Settlement] Processing ${bets.length} bet(s)...`);

        let winners = 0;
        let losers = 0;
        const settledUsers = []; // For socket notifications

        // 2. Settle each bet atomically via RPC
        for (const bet of bets) {
            const isWinner = bet.selected_team === winnerTeam;

            try {
                const { data: result, error: settleError } = await supabaseAdmin
                    .rpc('settle_ipl_bet', {
                        p_bet_id: bet.id,
                        p_won: isWinner
                    });

                if (settleError) {
                    console.error(`[IPL Settlement] Error settling bet ${bet.id}:`, settleError);
                    continue;
                }

                if (result && result.success) {
                    if (isWinner) {
                        winners++;
                        settledUsers.push({
                            userId: bet.user_id,
                            won: true,
                            payout: bet.potential_payout,
                            team: bet.selected_team,
                            odds: bet.odds_at_placement,
                            betAmount: bet.bet_amount,
                            newBalance: result.new_balance
                        });
                        console.log(
                            `  ✅ Winner: user=${bet.user_id} team=${bet.selected_team} ` +
                            `payout=$${bet.potential_payout}`
                        );
                    } else {
                        losers++;
                        settledUsers.push({
                            userId: bet.user_id,
                            won: false,
                            payout: 0,
                            team: bet.selected_team,
                            betAmount: bet.bet_amount
                        });
                        console.log(
                            `  ❌ Loser:  user=${bet.user_id} team=${bet.selected_team} ` +
                            `lost=$${bet.bet_amount}`
                        );
                    }
                }
            } catch (betErr) {
                console.error(`[IPL Settlement] Exception settling bet ${bet.id}:`, betErr.message);
            }
        }

        // 3. Broadcast settlement to connected clients
        if (io) {
            // Global settlement event
            io.to('ipl').emit('ipl-match-settled', {
                matchId,
                winnerTeam,
                totalBets: bets.length,
                winners,
                losers
            });

            // Per-user notifications
            for (const u of settledUsers) {
                io.to(`user_${u.userId}`).emit('ipl-bet-settled', {
                    matchId,
                    won: u.won,
                    payout: u.payout,
                    team: u.team,
                    betAmount: u.betAmount,
                    newBalance: u.newBalance || null
                });
            }
        }

        console.log(
            `🏏 [IPL Settlement] Done: ${winners} winner(s), ${losers} loser(s) ` +
            `out of ${bets.length} bet(s)`
        );

        return { success: true, settled: bets.length, winners, losers };
    } catch (err) {
        console.error('[IPL Settlement] Fatal error:', err);
        return { success: false, error: err.message };
    }
}

/**
 * Refund all pending bets for a match (e.g. match abandoned).
 */
async function refundMatch(matchId, io) {
    console.log(`🏏 [IPL Settlement] Refunding all bets for match ${matchId}`);

    try {
        const { data: bets, error } = await supabaseAdmin
            .from('ipl_bets')
            .select('*')
            .eq('match_id', matchId)
            .eq('status', 'pending');

        if (error || !bets || bets.length === 0) {
            return { success: true, refunded: 0 };
        }

        let refunded = 0;

        for (const bet of bets) {
            try {
                // Credit back the bet amount
                await supabaseAdmin
                    .from('users')
                    .update({ cash: supabaseAdmin.rpc ? undefined : 0 })
                    .eq('id', bet.user_id);

                // Use raw SQL via RPC if available, otherwise manual update
                const { error: refErr } = await supabaseAdmin.rpc('process_transaction', {
                    p_user_id: bet.user_id,
                    p_type: 'refund',
                    p_amount: parseFloat(bet.bet_amount),
                    p_description: `IPL Refund: ${bet.match_title}`,
                    p_metadata: { game: 'ipl', match_id: matchId }
                });

                if (!refErr) {
                    await supabaseAdmin
                        .from('ipl_bets')
                        .update({ status: 'refunded', settled_at: new Date().toISOString() })
                        .eq('id', bet.id);
                    refunded++;
                }
            } catch (e) {
                console.error(`[IPL Settlement] Refund error for bet ${bet.id}:`, e.message);
            }
        }

        if (io) {
            io.to('ipl').emit('ipl-match-refunded', { matchId, refunded });
        }

        return { success: true, refunded };
    } catch (err) {
        console.error('[IPL Settlement] Refund fatal error:', err);
        return { success: false, error: err.message };
    }
}

module.exports = { settleMatch, refundMatch };
