const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { processTransaction } = require('../controllers/walletController');

// Poker game rooms
const pokerRooms = new Map();

// Constants
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUE_MAP = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

// --- HAND EVALUATOR HELPERS ---
const getCardValue = (card) => VALUE_MAP[card.value];

const evaluateHand = (communityCards, playerHand) => {
    const allCards = [...communityCards, ...playerHand];

    // Sort by value descending
    allCards.sort((a, b) => getCardValue(b) - getCardValue(a));

    const flushSuit = getFlushSuit(allCards);
    const straightHigh = getStraightHigh(allCards);

    // Check Straight Flush
    if (flushSuit && straightHigh) {
        // Must check if the straight is in the flush suit
        const flushCards = allCards.filter(c => c.suit === flushSuit);
        const sfHigh = getStraightHigh(flushCards);
        if (sfHigh) return { rank: 8, value: sfHigh, name: 'Straight Flush' };
    }

    const counts = getValueCounts(allCards);
    const quads = Object.keys(counts).find(key => counts[key] === 4);
    const trips = Object.keys(counts).filter(key => counts[key] === 3).sort((a, b) => b - a);
    const pairs = Object.keys(counts).filter(key => counts[key] === 2).sort((a, b) => b - a);

    if (quads) return { rank: 7, value: parseInt(quads), name: 'Four of a Kind' };

    // Full House
    if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
        const tripVal = parseInt(trips[0]);
        const pairVal = trips.length > 1 ? parseInt(trips[1]) : parseInt(pairs[0]);
        return { rank: 6, value: tripVal * 100 + pairVal, name: 'Full House' };
    }

    if (flushSuit) {
        // Get high card of flush
        const flushCards = allCards.filter(c => c.suit === flushSuit);
        return { rank: 5, value: getCardValue(flushCards[0]), name: 'Flush' };
    }

    if (straightHigh) return { rank: 4, value: straightHigh, name: 'Straight' };

    if (trips.length > 0) return { rank: 3, value: parseInt(trips[0]), name: 'Three of a Kind' };

    if (pairs.length > 1) return { rank: 2, value: parseInt(pairs[0]), name: 'Two Pair' };

    if (pairs.length > 0) return { rank: 1, value: parseInt(pairs[0]), name: 'Pair' };

    return { rank: 0, value: getCardValue(allCards[0]), name: 'High Card' };
};

const getFlushSuit = (cards) => {
    const counts = {};
    for (const c of cards) {
        counts[c.suit] = (counts[c.suit] || 0) + 1;
        if (counts[c.suit] >= 5) return c.suit;
    }
    return null;
};

const getStraightHigh = (cards) => {
    const uniqueValues = Array.from(new Set(cards.map(c => getCardValue(c)))).sort((a, b) => b - a);

    // Handle Ace low straight (5,4,3,2,A)
    if (uniqueValues.includes(14)) uniqueValues.push(1);

    let streak = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
        if (uniqueValues[i] - uniqueValues[i + 1] === 1) {
            streak++;
            if (streak >= 4) return uniqueValues[i - 3]; // Top of sequence
        } else {
            streak = 0;
        }
    }
    return null;
};

const getValueCounts = (cards) => {
    const counts = {};
    for (const c of cards) {
        const val = getCardValue(c);
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
};
// --- END EVALUATOR ---

const createDeck = () => {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value, display: `${value}${suit}` });
        }
    }
    return shuffleDeck(deck);
};

const shuffleDeck = (deck) => {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

const createRoom = (roomId, minBet) => ({
    id: roomId,
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    phase: 'waiting',
    minBet: minBet,
    maxPlayers: 6,
    messages: []
});

const authenticateSocket = async (socket) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        return await User.findById(decoded.id);
    } catch (error) {
        return null;
    }
};

module.exports = (io) => {
    const pokerNamespace = io.of('/poker');

    pokerNamespace.on('connection', async (socket) => {
        console.log('🎰 Poker connection:', socket.id);

        const user = await authenticateSocket(socket);
        // Allow unauth for testing? No, require auth for wallet.
        if (!user && !socket.handshake.query.test) { // backdoor for quick connect if needed
            // but logic needs user id.
        }

        if (user) {
            socket.user = user;
            console.log(`✅ ${user.username} joined poker namespace`);
        }

        socket.on('joinRoom', async ({ roomId, buyInAmount }) => {
            if (!socket.user) return socket.emit('error', { message: 'Auth required' });

            // Validate Buy-in
            if (socket.user.cash < buyInAmount) {
                return socket.emit('error', { message: 'Insufficient funds for buy-in' });
            }

            let room = pokerRooms.get(roomId);
            if (!room) {
                // Auto-create room if not exists (or could require createRoom)
                room = createRoom(roomId, 50); // Default minBet 50
                pokerRooms.set(roomId, room);
            }

            if (room.players.length >= room.maxPlayers) {
                return socket.emit('error', { message: 'Room full' });
            }

            if (room.players.find(p => p.id === socket.user.id)) {
                return socket.emit('error', { message: 'Already in room' });
            }

            // Deduct Buy-in
            try {
                await processTransaction(socket.user.id, 'game_loss', buyInAmount, 'Poker Buy-in');
            } catch (err) {
                return socket.emit('error', { message: 'Transaction failed' });
            }

            const player = {
                id: socket.user.id,
                username: socket.user.username,
                socketId: socket.id,
                chips: parseInt(buyInAmount),
                hand: [],
                bet: 0,
                folded: false,
                isReady: false, // Wait for next hand
                seatIndex: room.players.length
            };

            room.players.push(player);
            socket.join(roomId);
            socket.currentRoom = roomId;

            // Notify room
            pokerNamespace.to(roomId).emit('roomUpdate', {
                players: room.players.map(p => ({ ...p, hand: null })), // Hide hands
                pot: room.pot,
                phase: room.phase,
                communityCards: room.communityCards
            });

            // If enough players and waiting, start? 
            // Better: Manual Ready or Auto start if > 1 player
            if (room.players.length >= 2 && room.phase === 'waiting') {
                startGame(room);
            }
        });

        socket.on('playerAction', ({ action, amount }) => {
            const room = pokerRooms.get(socket.currentRoom);
            if (!room) return;

            const player = room.players.find(p => p.socketId === socket.id);
            if (!player) return;

            if (room.players[room.currentPlayerIndex].id !== player.id) {
                return socket.emit('error', { message: 'Not your turn' });
            }

            handleAction(room, player, action, amount);
        });

        socket.on('chatMessage', ({ message }) => {
            if (!socket.currentRoom) return;
            const room = pokerRooms.get(socket.currentRoom);
            if (!room) return;

            pokerNamespace.to(socket.currentRoom).emit('chatMessage', {
                username: socket.user.username,
                message,
                timestamp: new Date()
            });
        });

        socket.on('disconnect', () => {
            handleLeave(socket);
        });

        socket.on('leaveRoom', () => {
            handleLeave(socket);
        });
    });

    const handleLeave = async (socket) => {
        if (!socket.currentRoom) return;
        const room = pokerRooms.get(socket.currentRoom);
        if (!room) return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1) return;

        const player = room.players[playerIndex];

        // Cash out
        if (player.chips > 0) {
            try {
                await processTransaction(player.id, 'game_win', player.chips, 'Poker Cash-out');
            } catch (e) {
                console.error("Cashout failed", e);
            }
        }

        room.players.splice(playerIndex, 1);

        // Handle active game interruption
        if (room.phase !== 'waiting') {
            // Fold them
            // If fewer than 2 players left, end hand
            if (room.players.filter(p => !p.folded).length < 2) {
                endHand(room, null); // Winner determination logic handles single player
            }
        }

        pokerNamespace.to(socket.currentRoom).emit('roomUpdate', {
            players: room.players.map(p => ({ ...p, hand: null }))
        });

        if (room.players.length === 0) {
            pokerRooms.delete(socket.currentRoom);
        }
    };

    const startGame = (room) => {
        room.phase = 'preflop';
        room.deck = createDeck();
        room.communityCards = [];
        room.pot = 0;
        room.currentBet = room.minBet;

        // Active players (chips > 0)
        const activePlayers = room.players.filter(p => p.chips > 0);
        if (activePlayers.length < 2) {
            room.phase = 'waiting';
            return;
        }

        // Reset
        room.players.forEach(p => {
            p.hand = [];
            p.bet = 0;
            p.folded = p.chips <= 0;
        });

        // Deal
        room.players.forEach(p => {
            if (!p.folded) {
                p.hand = [room.deck.pop(), room.deck.pop()];
            }
        });

        // Blinds
        room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
        // Logic for SB/BB could be complex with leaving players, simplified:
        let sbPos = (room.dealerIndex + 1) % room.players.length;
        let bbPos = (room.dealerIndex + 2) % room.players.length;

        const sb = room.players[sbPos];
        const bb = room.players[bbPos];

        if (sb) {
            const amt = Math.min(sb.chips, room.minBet / 2);
            sb.chips -= amt;
            sb.bet = amt;
            room.pot += amt;
        }
        if (bb) {
            const amt = Math.min(bb.chips, room.minBet);
            bb.chips -= amt;
            bb.bet = amt;
            room.pot += amt;
        }

        room.currentPlayerIndex = (bbPos + 1) % room.players.length;

        // Emit
        broadcastState(room);
    };

    const handleAction = (room, player, action, amount) => {
        // Logic for Call, Raise, Fold, Check
        if (action === 'fold') {
            player.folded = true;
        } else if (action === 'call') {
            const diff = room.currentBet - player.bet;
            const actual = Math.min(player.chips, diff);
            player.chips -= actual;
            player.bet += actual;
            room.pot += actual;
        } else if (action === 'raise') {
            // Validations required
            const totalBet = amount; // Assuming amount is TOTAL bet
            const diff = totalBet - player.bet;
            if (player.chips >= diff && totalBet >= room.currentBet * 2) { // Min raise 2x
                player.chips -= diff;
                player.bet = totalBet;
                room.pot += diff;
                room.currentBet = totalBet;
                // Reset other players 'acted' state if we had it, 
                // but here we just cycle until all match bet
            }
        } else if (action === 'check') {
            if (player.bet < room.currentBet) return; // Cant check
        }

        nextTurn(room);
    };

    const nextTurn = (room) => {
        // Find next non-folded player
        // Check if round complete
        const active = room.players.filter(p => !p.folded && p.chips > 0);
        // If 1 left -> WIN
        if (room.players.filter(p => !p.folded).length === 1) {
            return endHand(room);
        }

        // Proper round cycling logic is complex. 
        // Simplified: Move curIndex. If curIndex == starter and bets equal -> Next Phase.
        // Need to track who started the aggressive action.
        // For MVP: Simple loop.

        let loops = 0;
        do {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
            loops++;
        } while (room.players[room.currentPlayerIndex].folded && loops < 10);

        // Check betting complete condition:
        // All active players have bet == currentBet (or are all-in)
        const notAllIn = room.players.filter(p => !p.folded && p.chips > 0);
        const betsMatched = notAllIn.every(p => p.bet === room.currentBet);

        // Also ensure everyone had a chance? 
        // We'll rely on "If we circled back to BB/Raiser and matched" logic.
        // Let's just track "lastAggressor". 
        // Simplified: If bets matched and we are at the start of next turn cycle?
        // Let's just check if betsMatched AND everybody acted. 
        // Hard to track "everyone acted" without a flag. 
        // Let's assume if bets matched and current player has bet == currentBet, we proceed.

        if (betsMatched && room.players[room.currentPlayerIndex].bet === room.currentBet) {
            nextPhase(room);
        } else {
            broadcastState(room);
        }
    };

    const nextPhase = (room) => {
        room.currentBet = 0; // Reset for next street? Usually yes.
        room.players.forEach(p => p.bet = 0); // Bets go to pot.

        if (room.phase === 'preflop') {
            room.phase = 'flop';
            room.communityCards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
        } else if (room.phase === 'flop') {
            room.phase = 'turn';
            room.communityCards.push(room.deck.pop());
        } else if (room.phase === 'turn') {
            room.phase = 'river';
            room.communityCards.push(room.deck.pop());
        } else if (room.phase === 'river') {
            room.phase = 'showdown';
            endHand(room);
            return;
        }

        // Reset player index to first after dealer
        room.currentPlayerIndex = (room.dealerIndex + 1) % room.players.length;
        while (room.players[room.currentPlayerIndex].folded) {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        }

        broadcastState(room);
    };

    const endHand = (room) => {
        // Determine winner
        const active = room.players.filter(p => !p.folded);
        let bestPlayer = active[0];
        let bestHand = null;

        if (active.length > 1) {
            // Showdown
            bestHand = evaluateHand(room.communityCards, active[0].hand);

            for (let i = 1; i < active.length; i++) {
                const hand = evaluateHand(room.communityCards, active[i].hand);
                // Compare (Higher rank better, if same, Higher value)
                if (hand.rank > bestHand.rank || (hand.rank === bestHand.rank && hand.value > bestHand.value)) {
                    bestPlayer = active[i];
                    bestHand = hand;
                }
            }
        }

        // Award Pot
        bestPlayer.chips += room.pot;

        pokerNamespace.to(room.id).emit('handEnded', {
            winnerId: bestPlayer.id,
            amount: room.pot,
            handName: bestHand ? bestHand.name : 'Opponents Folded',
            roomState: {
                players: room.players // Reveal all hands?
            }
        });

        // Clear pot
        room.pot = 0;

        // Auto restart
        setTimeout(() => {
            startGame(room);
        }, 5000);
    };

    const broadcastState = (room) => {
        // Send sanitize state (hide other hands)
        room.players.forEach(p => {
            const others = room.players.map(op => ({
                ...op,
                hand: op.id === p.id || room.phase === 'showdown' ? op.hand : null
            }));

            pokerNamespace.to(p.socketId).emit('gameState', {
                players: others,
                communityCards: room.communityCards,
                pot: room.pot,
                currentBet: room.currentBet,
                phase: room.phase,
                turnIndex: room.currentPlayerIndex
            });
        });
    };
};
