const { v4: uuidv4 } = require('uuid');
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

        // Simple House Edge logic (optional, for now 100% payout of loser pool to winners? 
        // Or standard casino: You bet 10, you win 20 (2x) if correct.
        // If we do House vs Player: infinite liquidity needed.
        // If PvP Pool: Winners split the Loser Pool + their own bets.
        // Let's go with "The House" takes the risk (Casino style) for simplicity in MVP 
        // OR Pool style. Description says "winners split pot (minus optional house edge)".
        // Let's do Pool Style: 
        // Total Pot = All Bets. 
        // Winners get (Total Pot * (TheirBet / TotalWinningBets)) * (1 - HouseEdge).

        const HOUSE_EDGE_PERCENT = 0.05; // 5%
        const totalPot = gameState.stats.totalPot;
        const distributablePot = totalPot * (1 - HOUSE_EDGE_PERCENT);

        // Process Winners
        for (const bet of winningBets) {
            let winAmount = 0;
            if (totalWinningBetAmount > 0) {
                const share = bet.amount / totalWinningBetAmount;
                winAmount = share * distributablePot;
            } else {
                // Edge case: No winners, house takes all? Or refund?
                // Usually house takes all if no one wins.
            }

            // Allow integer transaction for cleanliness? Or keep float?
            // Helper supports float? Wallet usually float.
            winAmount = Math.floor(winAmount * 100) / 100;

            if (winAmount > 0) {
                try {
                    await processTransaction(bet.userId, 'game_win', winAmount, `CoinFlip Win (${result})`);
                } catch (err) {
                    console.error(`Failed to payout user ${bet.userId}:`, err);
                }
            }
        }

        // No need to process losers, they already paid 'game_loss' at bet time.

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
                    await processGameResult(); // Determine result now, but show it after animation
                } else if (gameState.status === 'flipping') {
                    gameState.status = 'result';
                    gameState.timeLeft = RESULT_TIME;
                } else if (gameState.status === 'result') {
                    startNewRound();
                }
                broadcastState();
            } else {
                // Optimize: Don't emit every second if not needed, but for timer we usually do.
                // To save bandwidth, clients can predict time, but syncing is safer.
                // Let's emit every second for MVP.
                broadcastState();
            }
        }, 1000);
    }

    coinflipNamespace.on('connection', (socket) => {
        console.log('🪙 User connected to CoinFlip:', socket.id);

        // Send initial state
        socket.emit('gameState', gameState);

        socket.on('join_check', () => {
            // Just a ping to ensure they get state
            socket.emit('gameState', gameState);
        });

        socket.on('placeBet', async ({ userId, amount, side, username }) => {
            if (gameState.status !== 'betting') {
                return socket.emit('error', { message: 'Betting is closed for this round' });
            }

            if (amount <= 0) return socket.emit('error', { message: 'Invalid amount' });

            // Deduct balance immediately
            try {
                // Check if already bet? (Optional: allow multiple bets)
                // Let's allow multiple bets.

                await processTransaction(userId, 'game_loss', amount, `CoinFlip Bet (${side})`);

                // Add to game state
                gameState.bets.push({ userId, username, amount, side, avatar: 'default' });

                // Update stats
                gameState.stats[side] += amount;
                gameState.stats.totalPot += amount;

                // Broadcast update immediately so others see the bet
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
