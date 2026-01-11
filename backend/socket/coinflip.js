const { v4: uuidv4 } = require('uuid');
const { supabase, supabaseAdmin } = require('../config/supabase');
const { processTransaction } = require('../controllers/walletController');

// Constants
const BETTING_TIME = 15; // seconds
const FLIP_TIME = 5; // seconds
const RESULT_TIME = 5; // seconds

// Game State (Single Global Room for now)
let gameState = {
    status: 'betting', // betting, flipping, result
    roundId: uuidv4(),
    timeLeft: BETTING_TIME,
    outcome: null, // 'heads' or 'tails'
    history: [], // Last 10 results
    bets: [], // { userId, username, amount, side, avatar }
    stats: { heads: 0, tails: 0, totalPot: 0 }
};

let gameLoopInterval;

module.exports = (io) => {
    const coinflipNamespace = io.of('/coinflip');

    const broadcastState = () => {
        coinflipNamespace.emit('gameState', gameState);
    };

    const startNewRound = () => {
        gameState.status = 'betting';
        gameState.roundId = uuidv4();
        gameState.timeLeft = BETTING_TIME;
        gameState.outcome = null;
        gameState.bets = [];
        gameState.stats = { heads: 0, tails: 0, totalPot: 0 };
        broadcastState();
    };

    const processGameResult = async () => {
        // 1. Determine Winner
        const result = Math.random() < 0.5 ? 'heads' : 'tails';
        gameState.outcome = result;
        gameState.history.unshift(result);
        if (gameState.history.length > 10) gameState.history.pop();

        // 2. Distribute Winnings
        const winningBets = gameState.bets.filter(b => b.side === result);
        const losingBets = gameState.bets.filter(b => b.side !== result);

        const totalWinningBetAmount = winningBets.reduce((sum, b) => sum + b.amount, 0);
        const totalLosingBetAmount = losingBets.reduce((sum, b) => sum + b.amount, 0);

        // Pool Style with House Edge
        const HOUSE_EDGE_PERCENT = 0.05; // 5%
        const totalPot = gameState.stats.totalPot;
        const distributablePot = totalPot * (1 - HOUSE_EDGE_PERCENT);

        // Process Winners
        const winnerPayouts = [];
        for (const bet of winningBets) {
            let winAmount = 0;
            if (totalWinningBetAmount > 0) {
                const share = bet.amount / totalWinningBetAmount;
                winAmount = share * distributablePot;
            }

            winAmount = Math.floor(winAmount * 100) / 100;

            if (winAmount > 0) {
                try {
                    await processTransaction(bet.userId, 'game_win', winAmount, `CoinFlip Win (${result})`, { gameType: 'coinflip' });
                    winnerPayouts.push({ userId: bet.userId, amount: winAmount });
                } catch (err) {
                    console.error(`Failed to payout user ${bet.userId}:`, err);
                }
            }
        }

        // Emit payout event to all clients so winners can refresh their balance
        coinflipNamespace.emit('roundResult', {
            outcome: result,
            winners: winnerPayouts
        });

        // Save game session to database
        try {
            await supabaseAdmin.from('game_sessions').insert({
                game_type: 'coinflip',
                room_id: gameState.roundId,
                players: gameState.bets.map(b => ({
                    userId: b.userId,
                    username: b.username,
                    side: b.side,
                    amount: b.amount
                })),
                status: 'completed',
                result: { outcome: result, totalPot, winningBets: winningBets.length },
                bets: gameState.bets,
                ended_at: new Date().toISOString()
            });
        } catch (err) {
            console.error('Failed to save coinflip session:', err);
        }

        broadcastState();
    };

    // Game Loop
    if (!gameLoopInterval) {
        gameLoopInterval = setInterval(async () => {
            gameState.timeLeft--;

            if (gameState.timeLeft <= 0) {
                if (gameState.status === 'betting') {
                    gameState.status = 'flipping';
                    gameState.timeLeft = FLIP_TIME;
                    await processGameResult();
                } else if (gameState.status === 'flipping') {
                    gameState.status = 'result';
                    gameState.timeLeft = RESULT_TIME;
                } else if (gameState.status === 'result') {
                    startNewRound();
                }
                broadcastState();
            } else {
                broadcastState();
            }
        }, 1000);
    }

    coinflipNamespace.on('connection', (socket) => {
        console.log('🪙 User connected to CoinFlip:', socket.id);

        // Send initial state
        socket.emit('gameState', gameState);

        socket.on('join_check', () => {
            socket.emit('gameState', gameState);
        });

        socket.on('placeBet', async ({ userId, amount, side, username }) => {
            if (gameState.status !== 'betting') {
                return socket.emit('error', { message: 'Betting is closed for this round' });
            }

            if (!userId) {
                return socket.emit('error', { message: 'Authentication required' });
            }

            if (amount <= 0) return socket.emit('error', { message: 'Invalid amount' });

            // Deduct balance immediately
            try {
                await processTransaction(userId, 'game_loss', amount, `CoinFlip Bet (${side})`, { gameType: 'coinflip' });

                // Add to game state
                gameState.bets.push({ userId, username, amount, side, avatar: 'default' });

                // Update stats
                gameState.stats[side] += amount;
                gameState.stats.totalPot += amount;

                // Broadcast update
                broadcastState();

                socket.emit('betConfirmed', { amount, side });

            } catch (error) {
                console.error('Bet error:', error);
                socket.emit('error', { message: error.message || 'Bet failed' });
            }
        });

        socket.on('chatMessage', ({ message, username }) => {
            const chatMsg = {
                id: uuidv4(),
                username: username || 'Anon',
                message,
                timestamp: new Date()
            };
            coinflipNamespace.emit('chatMessage', chatMsg);
        });

        socket.on('disconnect', () => {
            // No cleanup needed for global room
        });
    });
};
