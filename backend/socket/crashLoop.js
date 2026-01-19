/**
 * AVIATOR (CRASH) GAME ENGINE
 * Real-time multiplayer crash game with provably fair RNG
 */

const crypto = require('crypto');
const { supabase } = require('../config/supabase');

// Game configuration
const CONFIG = {
    WAITING_TIME: 5000,      // 5 seconds waiting phase
    TICK_INTERVAL: 100,      // 100ms tick rate
    HOUSE_EDGE: 0.04,        // 4% house edge
    MAX_MULTIPLIER: 1000,    // Maximum crash point
};

// Current game state
let currentRound = null;
let gameInterval = null;
let roundStartTime = null;
let isCrashing = false;
let io = null;

/**
 * Generate provably fair crash point
 * Uses SHA256 hash of server seed
 */
function generateCrashPoint(serverSeed, clientSeed = 'stakex_public_seed') {
    const hash = crypto.createHmac('sha256', serverSeed)
        .update(clientSeed)
        .digest('hex');

    // Convert hash to crash point
    // Using first 8 characters (32 bits) of hash
    const h = parseInt(hash.substring(0, 8), 16);

    // Apply house edge and calculate crash point
    // Formula: 99 / (1 - h / 2^32) with house edge
    const e = Math.pow(2, 32);
    const crashPoint = Math.max(1.00, (100 * e - h) / (e - h) * (1 - CONFIG.HOUSE_EDGE) / 100);

    return Math.min(crashPoint, CONFIG.MAX_MULTIPLIER);
}

/**
 * Calculate current multiplier based on elapsed time
 * Formula: 1.00 * e^(0.00006 * ms)
 */
function calculateMultiplier(elapsedMs) {
    return 1.00 * Math.pow(Math.E, 0.00006 * elapsedMs);
}

/**
 * Create a new round
 */
async function createRound() {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = 'stakex_public_seed';
    const crashPoint = generateCrashPoint(serverSeed, clientSeed);

    // Hash the server seed (revealed after round ends)
    const hash = crypto.createHash('sha256').update(serverSeed).digest('hex');

    const { data, error } = await supabase
        .from('crash_rounds')
        .insert({
            crash_point: parseFloat(crashPoint.toFixed(2)),
            status: 'waiting',
            hash: hash,
            server_seed: serverSeed, // Will be revealed after crash
            client_seed: clientSeed
        })
        .select()
        .single();

    if (error) {
        console.error('Error creating crash round:', error);
        return null;
    }

    return data;
}

/**
 * Start waiting phase
 */
async function startWaitingPhase() {
    console.log('🎰 [Aviator] Starting new round...');

    currentRound = await createRound();
    if (!currentRound) {
        console.error('Failed to create round, retrying...');
        setTimeout(startWaitingPhase, 1000);
        return;
    }

    // Emit waiting phase
    io.to('aviator').emit('game_state', {
        phase: 'waiting',
        roundId: currentRound.id,
        hash: currentRound.hash,
        countdown: CONFIG.WAITING_TIME
    });

    console.log(`🎰 [Aviator] Round ${currentRound.id} - Waiting phase (${CONFIG.WAITING_TIME / 1000}s)`);

    // After waiting, start flying
    setTimeout(startFlyingPhase, CONFIG.WAITING_TIME);
}

/**
 * Start flying phase
 */
async function startFlyingPhase() {
    if (!currentRound) return;

    // Update round status
    await supabase
        .from('crash_rounds')
        .update({ status: 'flying', start_time: new Date().toISOString() })
        .eq('id', currentRound.id);

    roundStartTime = Date.now();

    console.log(`🛫 [Aviator] Round ${currentRound.id} - Flying! Crash at ${currentRound.crash_point}x`);

    // Emit flying start
    io.to('aviator').emit('game_state', {
        phase: 'flying',
        roundId: currentRound.id,
        startTime: roundStartTime
    });

    // Start tick loop
    gameInterval = setInterval(gameTick, CONFIG.TICK_INTERVAL);
}

/**
 * Game tick - runs every 100ms during flying phase
 */
async function gameTick() {
    // Skip if no active round or already crashing
    if (!currentRound || !roundStartTime || isCrashing) return;

    const elapsed = Date.now() - roundStartTime;
    const multiplier = calculateMultiplier(elapsed);
    const round = currentRound; // Save reference

    // Check if crashed
    if (multiplier >= round.crash_point) {
        await handleCrash(round.crash_point);
        return;
    }

    // Check for auto cashouts
    await processAutoCashouts(multiplier);

    // Emit tick (check round still exists)
    if (currentRound && !isCrashing) {
        io.to('aviator').emit('tick', {
            multiplier: parseFloat(multiplier.toFixed(2)),
            elapsed: elapsed
        });
    }
}

/**
 * Process auto cashouts
 */
async function processAutoCashouts(currentMultiplier) {
    if (!currentRound) return;

    // Get active bets with auto cashout <= current multiplier
    const { data: bets, error } = await supabase
        .from('crash_bets')
        .select('*')
        .eq('round_id', currentRound.id)
        .eq('status', 'active')
        .not('auto_cashout', 'is', null)
        .lte('auto_cashout', currentMultiplier);

    if (error || !bets) return;

    // Process each auto cashout
    for (const bet of bets) {
        await cashOutBet(bet.user_id, bet.bet_number, bet.auto_cashout);
    }
}

/**
 * Cash out a bet
 */
async function cashOutBet(userId, betNumber, multiplier) {
    if (!currentRound) return { success: false, error: 'No active round' };

    const { data, error } = await supabase.rpc('fn_cash_out_crash', {
        p_user_id: userId,
        p_round_id: currentRound.id,
        p_multiplier: parseFloat(multiplier.toFixed(2)),
        p_bet_number: betNumber
    });

    if (error) {
        console.error('Cash out error:', error);
        return { success: false, error: error.message };
    }

    if (data.success) {
        // Get user info for broadcast
        const { data: user } = await supabase
            .from('users')
            .select('username')
            .eq('id', userId)
            .single();

        // Broadcast cashout
        io.to('aviator').emit('player_cashout', {
            username: user?.username || 'Anonymous',
            multiplier: multiplier,
            profit: data.profit
        });
    }

    return data;
}

/**
 * Handle crash
 */
async function handleCrash(crashPoint) {
    // Prevent multiple crash calls
    if (isCrashing) return;
    isCrashing = true;

    // Stop the interval immediately
    if (gameInterval) {
        clearInterval(gameInterval);
        gameInterval = null;
    }

    // Save round data before nullifying
    const round = currentRound;
    if (!round) {
        isCrashing = false;
        return;
    }

    console.log(`💥 [Aviator] Round ${round.id} CRASHED at ${crashPoint}x`);

    // Emit crash first (before any async operations that might fail)
    io.to('aviator').emit('game_state', {
        phase: 'crashed',
        roundId: round.id,
        crashPoint: crashPoint,
        serverSeed: round.server_seed
    });

    // Reset state
    currentRound = null;
    roundStartTime = null;

    // Update round status in DB
    try {
        await supabase
            .from('crash_rounds')
            .update({
                status: 'crashed',
                end_time: new Date().toISOString()
            })
            .eq('id', round.id);

        // Settle all remaining bets (mark as lost)
        await supabase.rpc('fn_settle_crash_round', {
            p_round_id: round.id
        });

        // Broadcast updated history to all connected players
        const { data: history } = await supabase.rpc('fn_get_crash_history', { p_limit: 20 });
        io.to('aviator').emit('history', history || []);
        console.log('📊 [Aviator] Broadcast updated history to all players');
    } catch (err) {
        console.error('Error settling crash round:', err);
    }

    // Start new round after delay
    isCrashing = false;
    setTimeout(startWaitingPhase, 3000);
}

/**
 * Handle player bet placement
 */
async function handlePlaceBet(socket, data) {
    const { userId, amount, betNumber = 1, autoCashout } = data;
    console.log('[Aviator] place_bet received:', { userId, amount, betNumber, autoCashout });

    if (!currentRound || currentRound.status !== 'waiting') {
        console.log('[Aviator] Rejecting bet - round not waiting');
        socket.emit('bet_result', { success: false, error: 'Round not accepting bets', betNumber: Number(betNumber) });
        return;
    }

    const { data: result, error } = await supabase.rpc('fn_place_crash_bet', {
        p_user_id: userId,
        p_round_id: currentRound.id,
        p_amount: amount,
        p_bet_number: betNumber,
        p_auto_cashout: autoCashout || null
    });

    console.log('[Aviator] RPC result:', result, 'error:', error);

    if (error) {
        socket.emit('bet_result', { success: false, error: error.message, betNumber: Number(betNumber) });
        return;
    }

    // Ensure proper structure
    const betResult = {
        success: result?.success || false,
        bet_id: result?.bet_id,
        new_balance: result?.new_balance,
        betNumber: Number(betNumber)
    };

    console.log('[Aviator] Emitting bet_result:', betResult);
    socket.emit('bet_result', betResult);

    if (result?.success) {
        // Get user info for broadcast
        const { data: user } = await supabase
            .from('users')
            .select('username')
            .eq('id', userId)
            .single();

        // Broadcast new bet
        io.to('aviator').emit('new_bet', {
            username: user?.username || 'Anonymous',
            amount: amount,
            betNumber: Number(betNumber)
        });
    }
}

/**
 * Handle player cash out request
 */
async function handleCashOut(socket, data) {
    const { userId, betNumber = 1, clientMultiplier } = data;

    if (!currentRound || !roundStartTime) {
        socket.emit('cashout_result', { success: false, error: 'No active round' });
        return;
    }

    // Calculate server multiplier
    const elapsed = Date.now() - roundStartTime;
    const serverMultiplier = calculateMultiplier(elapsed);

    // Lag compensation: honor client multiplier if within reasonable range
    let finalMultiplier = serverMultiplier;
    if (clientMultiplier && clientMultiplier < serverMultiplier) {
        // Client is slightly behind, honor their multiplier
        const diff = serverMultiplier - clientMultiplier;
        if (diff <= 0.1) { // Allow up to 0.1x lag compensation
            finalMultiplier = clientMultiplier;
        }
    }

    // Check if already crashed
    if (finalMultiplier >= currentRound.crash_point) {
        socket.emit('cashout_result', { success: false, error: 'Too late! Already crashed' });
        return;
    }

    const result = await cashOutBet(userId, betNumber, finalMultiplier);
    socket.emit('cashout_result', result);
}

/**
 * Get current game state for new connections
 */
function getCurrentState() {
    if (!currentRound) {
        return { phase: 'waiting_for_round' };
    }

    if (!roundStartTime) {
        return {
            phase: 'waiting',
            roundId: currentRound.id,
            hash: currentRound.hash
        };
    }

    const elapsed = Date.now() - roundStartTime;
    const multiplier = calculateMultiplier(elapsed);

    return {
        phase: 'flying',
        roundId: currentRound.id,
        multiplier: parseFloat(multiplier.toFixed(2)),
        elapsed: elapsed,
        startTime: roundStartTime
    };
}

/**
 * Initialize the crash game with Socket.io
 */
function initCrashGame(socketIo) {
    io = socketIo;

    io.on('connection', (socket) => {
        // Join aviator room
        socket.on('join_aviator', async () => {
            socket.join('aviator');

            // Send current state
            socket.emit('game_state', getCurrentState());

            // Send round history
            const { data: history } = await supabase.rpc('fn_get_crash_history', { p_limit: 20 });
            socket.emit('history', history || []);

            // Send current round bets
            if (currentRound) {
                const { data: bets } = await supabase
                    .from('crash_bets')
                    .select('*, users(username)')
                    .eq('round_id', currentRound.id);
                socket.emit('round_bets', bets || []);
            }
        });

        socket.on('leave_aviator', () => {
            socket.leave('aviator');
        });

        socket.on('place_bet', (data) => handlePlaceBet(socket, data));
        socket.on('cash_out', (data) => handleCashOut(socket, data));
    });

    // Start the game loop
    console.log('🎰 [Aviator] Game engine initialized');
    startWaitingPhase();
}

module.exports = initCrashGame;
