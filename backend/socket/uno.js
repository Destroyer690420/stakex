const { supabase, supabaseAdmin } = require('../config/supabase');

// Track active rooms and their players
const activeRooms = new Map(); // roomId -> Set of socket ids
const playerSockets = new Map(); // socketId -> { roomId, userId }
const disconnectTimers = new Map(); // socketId -> timeout

const DISCONNECT_TIMEOUT = 30000; // 30 seconds before forfeit
const TURN_TIMEOUT = 15000; // 15 seconds per turn
const ROOM_INACTIVITY_TIMEOUT = 10 * 60 * 1000; // 10 minutes before room is deleted
const CLEANUP_INTERVAL = 5 * 60 * 1000; // Run cleanup every 5 minutes

module.exports = (io) => {
    const unoNamespace = io.of('/uno');

    // Cleanup stale rooms every 5 minutes
    const cleanupInterval = setInterval(async () => {
        try {
            const { data, error } = await supabaseAdmin.rpc('fn_cleanup_stale_uno_rooms', {
                p_inactivity_minutes: 10
            });

            if (error) {
                console.error('🎴 Room cleanup error:', error);
            } else if (data?.cleaned_count > 0) {
                console.log(`🎴 Cleaned up ${data.cleaned_count} stale UNO rooms`);
            }
        } catch (err) {
            console.error('🎴 Room cleanup failed:', err);
        }
    }, CLEANUP_INTERVAL);

    // Helper function to broadcast full room state to all players
    async function broadcastRoomState(roomId) {
        try {
            const { data: room } = await supabaseAdmin
                .from('uno_rooms')
                .select('*')
                .eq('id', roomId)
                .single();

            if (!room) return;

            const { data: players } = await supabaseAdmin
                .from('uno_players')
                .select('id, room_id, user_id, username, avatar_url, seat_index, is_ready, has_paid, has_called_uno, hand')
                .eq('room_id', roomId);

            // Get all sockets in this room and send personalized state
            const roomSockets = activeRooms.get(roomId);
            if (!roomSockets) return;

            for (const socketId of roomSockets) {
                const playerInfo = playerSockets.get(socketId);
                if (!playerInfo) continue;

                const socket = unoNamespace.sockets.get(socketId);
                if (!socket) continue;

                // Find this player's hand
                const myPlayerData = players?.find(p => p.user_id === playerInfo.userId);
                const myHand = myPlayerData?.hand || [];

                // Build players list with hand counts (not actual hands)
                const playersWithCounts = players?.map(p => ({
                    id: p.id,
                    room_id: p.room_id,
                    user_id: p.user_id,
                    username: p.username,
                    avatar_url: p.avatar_url,
                    seat_index: p.seat_index,
                    is_ready: p.is_ready,
                    has_paid: p.has_paid,
                    has_called_uno: p.has_called_uno,
                    hand_count: p.hand?.length || 0
                }));

                socket.emit('roomState', {
                    room,
                    players: playersWithCounts,
                    myHand
                });
            }
        } catch (err) {
            console.error('Error broadcasting room state:', err);
        }
    }

    async function handleLeaveRoom(socket, roomId) {
        socket.leave(roomId);
        const playerInfo = playerSockets.get(socket.id);

        if (playerInfo) {
            // Call database to remove player from room
            try {
                await supabaseAdmin.rpc('fn_leave_uno_room', {
                    p_user_id: playerInfo.userId,
                    p_room_id: roomId
                });
                console.log(`🎴 Player ${playerInfo.userId} left room ${roomId}`);
            } catch (err) {
                console.error('Error leaving room:', err);
            }

            socket.to(roomId).emit('playerLeft', { userId: playerInfo.userId });
            playerSockets.delete(socket.id);

            // Broadcast updated state to remaining players
            await broadcastRoomState(roomId);
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

            // Fetch and send current room state to this player
            try {
                const { data: room } = await supabaseAdmin
                    .from('uno_rooms')
                    .select('*')
                    .eq('id', roomId)
                    .single();

                const { data: players } = await supabaseAdmin
                    .from('uno_players')
                    .select('id, room_id, user_id, username, avatar_url, seat_index, is_ready, has_paid, has_called_uno, hand')
                    .eq('room_id', roomId);

                const playersWithCounts = players?.map(p => ({
                    id: p.id,
                    room_id: p.room_id,
                    user_id: p.user_id,
                    username: p.username,
                    avatar_url: p.avatar_url,
                    seat_index: p.seat_index,
                    is_ready: p.is_ready,
                    has_paid: p.has_paid,
                    has_called_uno: p.has_called_uno,
                    hand_count: p.hand?.length || 0
                }));

                // Get this player's hand
                const myPlayerData = players?.find(p => p.user_id === userId);

                socket.emit('roomState', {
                    room,
                    players: playersWithCounts,
                    myHand: myPlayerData?.hand || []
                });

                // Notify others that player joined/reconnected and broadcast updated state
                socket.to(roomId).emit('playerJoined', { userId });

                // Broadcast to all (including newly joined) after a small delay
                setTimeout(() => broadcastRoomState(roomId), 100);

            } catch (err) {
                console.error('Error fetching room state:', err);
                socket.emit('error', { message: 'Failed to fetch room state' });
            }
        });

        // Request fresh room state (called after actions like toggleReady, playCard, etc.)
        socket.on('requestRoomState', async ({ roomId }) => {
            if (!roomId) return;
            await broadcastRoomState(roomId);
        });

        // Leave room
        socket.on('leaveRoom', ({ roomId }) => {
            handleLeaveRoom(socket, roomId);
        });

        // Card played - broadcast updated state to all
        socket.on('cardPlayed', async ({ roomId, card, playerId, newColor }) => {
            socket.to(roomId).emit('cardPlayed', { card, playerId, newColor });
            // Broadcast full state so everyone sees the update
            await broadcastRoomState(roomId);
        });

        // Card drawn - broadcast updated state
        socket.on('cardDrawn', async ({ roomId, playerId }) => {
            socket.to(roomId).emit('cardDrawn', { playerId });
            await broadcastRoomState(roomId);
        });

        // UNO called
        socket.on('unoCall', ({ roomId, userId, username }) => {
            unoNamespace.to(roomId).emit('unoCall', { userId, username });
        });

        // Game started - broadcast full state
        socket.on('gameStarted', async ({ roomId }) => {
            unoNamespace.to(roomId).emit('gameStarted');
            await broadcastRoomState(roomId);
        });

        // Turn timeout - auto draw
        socket.on('turnTimeout', async ({ roomId, userId }) => {
            const playerInfo = playerSockets.get(socket.id);
            if (!playerInfo || playerInfo.roomId !== roomId) return;

            try {
                // Force draw a card for the timed-out player
                const { data, error } = await supabaseAdmin.rpc('fn_uno_draw_card', {
                    p_user_id: userId,
                    p_room_id: roomId
                });

                if (!error && data?.success) {
                    unoNamespace.to(roomId).emit('autoDrawn', { userId });
                    await broadcastRoomState(roomId);
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
                        p_user_id: userId,
                        p_room_id: roomId
                    });

                    // Notify room
                    unoNamespace.to(roomId).emit('playerForfeited', { userId });
                    await broadcastRoomState(roomId);

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
