const { supabase, supabaseAdmin } = require('../config/supabase');

// Track active rooms and their players
const activeRooms = new Map(); // roomId -> Set of socket ids
const playerSockets = new Map(); // socketId -> { roomId, userId }
const disconnectTimers = new Map(); // socketId -> timeout

const DISCONNECT_TIMEOUT = 30000; // 30 seconds before forfeit
const TURN_TIMEOUT = 15000; // 15 seconds per turn

module.exports = (io) => {
    const unoNamespace = io.of('/uno');

    // Subscribe to Supabase realtime for room updates
    const roomChannel = supabaseAdmin
        .channel('uno-rooms-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'uno_rooms'
        }, (payload) => {
            const roomId = payload.new?.id || payload.old?.id;
            if (roomId && activeRooms.has(roomId)) {
                // Broadcast room update to all players in this room
                unoNamespace.to(roomId).emit('roomUpdated', payload.new || { deleted: true });
            }
        })
        .subscribe();

    const playerChannel = supabaseAdmin
        .channel('uno-players-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'uno_players'
        }, (payload) => {
            const roomId = payload.new?.room_id || payload.old?.room_id;
            if (roomId && activeRooms.has(roomId)) {
                // Broadcast player updates (without revealing hands)
                const playerData = payload.new ? {
                    ...payload.new,
                    hand: undefined, // Don't reveal hand
                    hand_count: payload.new.hand ? JSON.parse(JSON.stringify(payload.new.hand)).length : 0
                } : { deleted: true, user_id: payload.old?.user_id };

                unoNamespace.to(roomId).emit('playerUpdated', playerData);
            }
        })
        .subscribe();

    function handleLeaveRoom(socket, roomId) {
        socket.leave(roomId);
        const playerInfo = playerSockets.get(socket.id);

        if (playerInfo) {
            socket.to(roomId).emit('playerLeft', { userId: playerInfo.userId });
            playerSockets.delete(socket.id);
        }

        const roomSockets = activeRooms.get(roomId);
        if (roomSockets) {
            roomSockets.delete(socket.id);
            if (roomSockets.size === 0) {
                activeRooms.delete(roomId);
            }
        }
    }

    unoNamespace.on('connection', (socket) => {
        console.log('🎴 User connected to UNO:', socket.id);

        // Join a room
        socket.on('joinRoom', async ({ roomId, userId }) => {
            if (!roomId || !userId) {
                return socket.emit('error', { message: 'Room ID and User ID required' });
            }

            // Clear any disconnect timer
            if (disconnectTimers.has(socket.id)) {
                clearTimeout(disconnectTimers.get(socket.id));
                disconnectTimers.delete(socket.id);
            }

            // Leave previous room if any
            const prevRoom = playerSockets.get(socket.id);
            if (prevRoom && prevRoom.roomId !== roomId) {
                socket.leave(prevRoom.roomId);
                const prevRoomSockets = activeRooms.get(prevRoom.roomId);
                if (prevRoomSockets) {
                    prevRoomSockets.delete(socket.id);
                }
            }

            // Join new room
            socket.join(roomId);
            playerSockets.set(socket.id, { roomId, userId });

            if (!activeRooms.has(roomId)) {
                activeRooms.set(roomId, new Set());
            }
            activeRooms.get(roomId).add(socket.id);

            // Fetch and send current room state
            try {
                const { data: room } = await supabaseAdmin
                    .from('uno_rooms')
                    .select('*')
                    .eq('id', roomId)
                    .single();

                const { data: players } = await supabaseAdmin
                    .from('uno_players')
                    .select('id, room_id, user_id, username, avatar_url, seat_index, is_ready, has_paid, has_called_uno')
                    .eq('room_id', roomId);

                // Get player counts for each player
                const { data: handCounts } = await supabaseAdmin
                    .from('uno_players')
                    .select('user_id, hand')
                    .eq('room_id', roomId);

                const playersWithCounts = players?.map(p => ({
                    ...p,
                    hand_count: handCounts?.find(h => h.user_id === p.user_id)?.hand?.length || 0
                }));

                // Get this player's hand
                const { data: myPlayer } = await supabaseAdmin
                    .from('uno_players')
                    .select('hand')
                    .eq('room_id', roomId)
                    .eq('user_id', userId)
                    .single();

                socket.emit('roomState', {
                    room,
                    players: playersWithCounts,
                    myHand: myPlayer?.hand || []
                });

                // Notify others that player joined/reconnected
                socket.to(roomId).emit('playerJoined', { userId });

            } catch (err) {
                console.error('Error fetching room state:', err);
                socket.emit('error', { message: 'Failed to fetch room state' });
            }
        });

        // Leave room
        socket.on('leaveRoom', ({ roomId }) => {
            handleLeaveRoom(socket, roomId);
        });

        // Card played notification
        socket.on('cardPlayed', ({ roomId, card, playerId, newColor }) => {
            socket.to(roomId).emit('cardPlayed', { card, playerId, newColor });
        });

        // Card drawn notification
        socket.on('cardDrawn', ({ roomId, playerId }) => {
            socket.to(roomId).emit('cardDrawn', { playerId });
        });

        // UNO called
        socket.on('unoCall', ({ roomId, userId, username }) => {
            unoNamespace.to(roomId).emit('unoCall', { userId, username });
        });

        // Game started
        socket.on('gameStarted', ({ roomId }) => {
            unoNamespace.to(roomId).emit('gameStarted');
        });

        // Turn timeout - auto draw
        socket.on('turnTimeout', async ({ roomId, userId }) => {
            const playerInfo = playerSockets.get(socket.id);
            if (!playerInfo || playerInfo.roomId !== roomId) return;

            try {
                // Force draw a card for the timed-out player
                const { data, error } = await supabaseAdmin.rpc('fn_uno_draw_card', {
                    p_room_id: roomId
                });

                if (!error && data?.success) {
                    unoNamespace.to(roomId).emit('autoDrawn', { userId });
                }
            } catch (err) {
                console.error('Turn timeout error:', err);
            }
        });

        // Chat message
        socket.on('chatMessage', ({ roomId, message, username }) => {
            unoNamespace.to(roomId).emit('chatMessage', {
                id: Date.now(),
                username,
                message,
                timestamp: new Date()
            });
        });

        // Handle disconnect
        socket.on('disconnect', () => {
            console.log('🎴 User disconnected from UNO:', socket.id);

            const playerInfo = playerSockets.get(socket.id);
            if (!playerInfo) return;

            const { roomId, userId } = playerInfo;

            // Set a timer - if they don't reconnect, forfeit
            const timer = setTimeout(async () => {
                console.log(`🎴 Player ${userId} forfeited due to disconnect timeout`);

                try {
                    // Call leave room to forfeit
                    await supabaseAdmin.rpc('fn_leave_uno_room', {
                        p_room_id: roomId
                    });

                    // Notify room
                    unoNamespace.to(roomId).emit('playerForfeited', { userId });

                } catch (err) {
                    console.error('Forfeit error:', err);
                }

                // Cleanup
                disconnectTimers.delete(socket.id);
                playerSockets.delete(socket.id);
                const roomSockets = activeRooms.get(roomId);
                if (roomSockets) {
                    roomSockets.delete(socket.id);
                    if (roomSockets.size === 0) {
                        activeRooms.delete(roomId);
                    }
                }
            }, DISCONNECT_TIMEOUT);

            disconnectTimers.set(socket.id, timer);
        });
    });

    console.log('🎴 UNO Socket handler initialized');
};
