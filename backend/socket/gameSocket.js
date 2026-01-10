const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Poker game rooms
const pokerRooms = new Map();

// Card deck
const SUITS = ['♠', '♥', '♦', '♣'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

// Create a new deck
const createDeck = () => {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value, display: `${value}${suit}` });
        }
    }
    return shuffleDeck(deck);
};

// Shuffle deck
const shuffleDeck = (deck) => {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

// Create a poker room
const createRoom = (roomId) => {
    return {
        id: roomId,
        players: [],
        deck: [],
        communityCards: [],
        pot: 0,
        currentBet: 0,
        dealerIndex: 0,
        currentPlayerIndex: 0,
        phase: 'waiting', // waiting, preflop, flop, turn, river, showdown
        minBet: 50,
        maxPlayers: 6,
        messages: []
    };
};

// Authenticate socket connection
const authenticateSocket = async (socket) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return null;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        return user;
    } catch (error) {
        return null;
    }
};

module.exports = (io) => {
    const pokerNamespace = io.of('/poker');

    pokerNamespace.on('connection', async (socket) => {
        console.log('🎰 New poker connection:', socket.id);

        const user = await authenticateSocket(socket);
        if (!user) {
            socket.emit('error', { message: 'Authentication required' });
            socket.disconnect();
            return;
        }

        socket.user = user;
        console.log(`✅ ${user.username} connected to poker`);

        // Get available rooms
        socket.on('getRooms', () => {
            const rooms = Array.from(pokerRooms.values()).map(room => ({
                id: room.id,
                players: room.players.length,
                maxPlayers: room.maxPlayers,
                minBet: room.minBet,
                phase: room.phase
            }));
            socket.emit('roomList', rooms);
        });

        // Create a new room
        socket.on('createRoom', ({ minBet }) => {
            const roomId = `room_${Date.now()}`;
            const room = createRoom(roomId);
            room.minBet = minBet || 50;
            pokerRooms.set(roomId, room);
            socket.emit('roomCreated', { roomId });
            pokerNamespace.emit('roomsUpdated');
        });

        // Join a room
        socket.on('joinRoom', async ({ roomId }) => {
            const room = pokerRooms.get(roomId);

            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }

            if (room.players.length >= room.maxPlayers) {
                socket.emit('error', { message: 'Room is full' });
                return;
            }

            if (room.players.find(p => p.oderId === user._id.toString())) {
                socket.emit('error', { message: 'Already in room' });
                return;
            }

            // Add player to room
            const player = {
                oderId: user._id.toString(),
                odername: user.username,
                socketId: socket.id,
                chips: Math.min(user.wallet.balance, 10000), // Buy-in capped at 10k
                hand: [],
                bet: 0,
                folded: false,
                isReady: false
            };

            room.players.push(player);
            socket.join(roomId);
            socket.currentRoom = roomId;

            socket.emit('joinedRoom', {
                roomId,
                players: room.players.map(p => ({
                    username: p.username,
                    chips: p.chips,
                    isReady: p.isReady
                })),
                minBet: room.minBet
            });

            pokerNamespace.to(roomId).emit('playerJoined', {
                username: user.username,
                players: room.players.length
            });
        });

        // Player ready
        socket.on('playerReady', () => {
            const room = pokerRooms.get(socket.currentRoom);
            if (!room) return;

            const player = room.players.find(p => p.oderId === user._id.toString());
            if (player) {
                player.isReady = true;
                pokerNamespace.to(socket.currentRoom).emit('playerReadyUpdate', {
                    username: user.username,
                    ready: true
                });

                // Check if all players ready (minimum 2)
                const readyPlayers = room.players.filter(p => p.isReady);
                if (readyPlayers.length >= 2 && readyPlayers.length === room.players.length) {
                    startGame(room, pokerNamespace);
                }
            }
        });

        // Player action (fold, call, raise)
        socket.on('playerAction', ({ action, amount }) => {
            const room = pokerRooms.get(socket.currentRoom);
            if (!room || room.phase === 'waiting') return;

            const playerIndex = room.players.findIndex(p => p.oderId === user._id.toString());
            if (playerIndex !== room.currentPlayerIndex) {
                socket.emit('error', { message: 'Not your turn' });
                return;
            }

            const player = room.players[playerIndex];

            switch (action) {
                case 'fold':
                    player.folded = true;
                    break;
                case 'call':
                    const callAmount = room.currentBet - player.bet;
                    player.chips -= callAmount;
                    player.bet = room.currentBet;
                    room.pot += callAmount;
                    break;
                case 'raise':
                    const raiseAmount = amount - player.bet;
                    player.chips -= raiseAmount;
                    player.bet = amount;
                    room.currentBet = amount;
                    room.pot += raiseAmount;
                    break;
                case 'check':
                    // Only valid if no bet to call
                    if (room.currentBet > player.bet) {
                        socket.emit('error', { message: 'Cannot check, must call or fold' });
                        return;
                    }
                    break;
            }

            // Broadcast action
            pokerNamespace.to(socket.currentRoom).emit('actionTaken', {
                player: user.username,
                action,
                amount: action === 'raise' ? amount : undefined,
                pot: room.pot
            });

            // Move to next player or next phase
            advanceGame(room, pokerNamespace);
        });

        // Chat message
        socket.on('chatMessage', ({ message }) => {
            const room = pokerRooms.get(socket.currentRoom);
            if (!room) return;

            const chatMessage = {
                username: user.username,
                message,
                timestamp: new Date()
            };

            room.messages.push(chatMessage);
            pokerNamespace.to(socket.currentRoom).emit('newMessage', chatMessage);
        });

        // Leave room
        socket.on('leaveRoom', () => {
            handleLeaveRoom(socket, pokerNamespace);
        });

        // Disconnect
        socket.on('disconnect', () => {
            console.log(`❌ ${user.username} disconnected`);
            handleLeaveRoom(socket, pokerNamespace);
        });
    });

    // Start a new game
    const startGame = (room, namespace) => {
        room.deck = createDeck();
        room.communityCards = [];
        room.pot = 0;
        room.phase = 'preflop';
        room.currentBet = room.minBet;

        // Reset players
        room.players.forEach((player, index) => {
            player.hand = [room.deck.pop(), room.deck.pop()];
            player.bet = 0;
            player.folded = false;
        });

        // Post blinds
        const sbIndex = (room.dealerIndex + 1) % room.players.length;
        const bbIndex = (room.dealerIndex + 2) % room.players.length;

        room.players[sbIndex].bet = room.minBet / 2;
        room.players[sbIndex].chips -= room.minBet / 2;
        room.players[bbIndex].bet = room.minBet;
        room.players[bbIndex].chips -= room.minBet;
        room.pot = room.minBet + room.minBet / 2;
        room.currentPlayerIndex = (bbIndex + 1) % room.players.length;

        // Send game state to each player (with their private hand)
        room.players.forEach(player => {
            const socketId = player.socketId;
            namespace.to(socketId).emit('gameStarted', {
                yourHand: player.hand,
                players: room.players.map(p => ({
                    username: p.username,
                    chips: p.chips,
                    bet: p.bet,
                    isDealer: room.players.indexOf(p) === room.dealerIndex
                })),
                pot: room.pot,
                currentBet: room.currentBet,
                yourTurn: room.players[room.currentPlayerIndex].socketId === socketId
            });
        });
    };

    // Advance game state
    const advanceGame = (room, namespace) => {
        const activePlayers = room.players.filter(p => !p.folded);

        // Check for winner (only one player left)
        if (activePlayers.length === 1) {
            endHand(room, namespace, activePlayers[0]);
            return;
        }

        // Move to next active player
        do {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        } while (room.players[room.currentPlayerIndex].folded);

        // Check if betting round is complete
        const bettingComplete = activePlayers.every(p => p.bet === room.currentBet || p.chips === 0);

        if (bettingComplete) {
            advancePhase(room, namespace);
        } else {
            // Notify whose turn it is
            namespace.to(room.id).emit('turnUpdate', {
                currentPlayer: room.players[room.currentPlayerIndex].username,
                currentBet: room.currentBet,
                pot: room.pot
            });
        }
    };

    // Advance to next phase
    const advancePhase = (room, namespace) => {
        // Reset bets for new round
        room.players.forEach(p => p.bet = 0);
        room.currentBet = 0;

        switch (room.phase) {
            case 'preflop':
                room.phase = 'flop';
                room.communityCards = [room.deck.pop(), room.deck.pop(), room.deck.pop()];
                break;
            case 'flop':
                room.phase = 'turn';
                room.communityCards.push(room.deck.pop());
                break;
            case 'turn':
                room.phase = 'river';
                room.communityCards.push(room.deck.pop());
                break;
            case 'river':
                room.phase = 'showdown';
                determineWinner(room, namespace);
                return;
        }

        // Set first player after dealer
        room.currentPlayerIndex = (room.dealerIndex + 1) % room.players.length;
        while (room.players[room.currentPlayerIndex].folded) {
            room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        }

        namespace.to(room.id).emit('phaseUpdate', {
            phase: room.phase,
            communityCards: room.communityCards,
            currentPlayer: room.players[room.currentPlayerIndex].username,
            pot: room.pot
        });
    };

    // Determine winner (simplified - just picks randomly for MVP)
    const determineWinner = (room, namespace) => {
        const activePlayers = room.players.filter(p => !p.folded);
        // For MVP: random winner among active players
        // TODO: Implement proper hand evaluation
        const winner = activePlayers[Math.floor(Math.random() * activePlayers.length)];
        endHand(room, namespace, winner);
    };

    // End the hand
    const endHand = (room, namespace, winner) => {
        winner.chips += room.pot;

        namespace.to(room.id).emit('handComplete', {
            winner: winner.username,
            pot: room.pot,
            players: room.players.map(p => ({
                username: p.username,
                chips: p.chips,
                hand: p.hand
            }))
        });

        // Reset for next hand
        setTimeout(() => {
            room.dealerIndex = (room.dealerIndex + 1) % room.players.length;
            room.phase = 'waiting';
            room.players.forEach(p => p.isReady = false);

            namespace.to(room.id).emit('newHandReady', {
                message: 'Ready up for the next hand!'
            });
        }, 5000);
    };

    // Handle player leaving room
    const handleLeaveRoom = (socket, namespace) => {
        if (socket.currentRoom) {
            const room = pokerRooms.get(socket.currentRoom);
            if (room) {
                room.players = room.players.filter(p => p.socketId !== socket.id);

                if (room.players.length === 0) {
                    pokerRooms.delete(socket.currentRoom);
                } else {
                    namespace.to(socket.currentRoom).emit('playerLeft', {
                        username: socket.user?.username,
                        players: room.players.length
                    });
                }
            }
            socket.leave(socket.currentRoom);
            namespace.emit('roomsUpdated');
        }
    };
};
