import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';
import io from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';

const useUnoGame = (roomId) => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    const [room, setRoom] = useState(null);
    const [players, setPlayers] = useState([]);
    const [myHand, setMyHand] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const socketRef = useRef(null);

    // Computed values - use String() for UUID comparisons
    const isMyTurn = String(room?.player_order?.[room?.current_turn_index]) === String(user?.id);
    const currentPlayer = room?.player_order?.[room?.current_turn_index];
    const canCallUno = myHand.length <= 2 && myHand.length > 0;
    const myPlayer = players.find(p => String(p.user_id) === String(user?.id));

    // Initialize socket connection
    useEffect(() => {
        if (!roomId || !user?.id) return;

        socketRef.current = io(`${SOCKET_URL}/uno`, {
            transports: ['websocket', 'polling']
        });

        const socket = socketRef.current;

        socket.on('connect', () => {
            console.log('Connected to UNO socket');
            socket.emit('joinRoom', { roomId, userId: user.id });
        });

        socket.on('roomState', (data) => {
            setRoom(data.room);
            setPlayers(data.players || []);
            setMyHand(data.myHand || []);
            setLoading(false);
        });

        socket.on('roomUpdated', (roomData) => {
            if (roomData.deleted) {
                toast.error('Room was closed');
                navigate('/games/uno');
                return;
            }
            setRoom(roomData);
        });

        socket.on('playerUpdated', (playerData) => {
            if (playerData.deleted) {
                setPlayers(prev => prev.filter(p => p.user_id !== playerData.user_id));
            } else {
                setPlayers(prev => {
                    const existing = prev.find(p => p.user_id === playerData.user_id);
                    if (existing) {
                        return prev.map(p => p.user_id === playerData.user_id ? { ...p, ...playerData } : p);
                    }
                    return [...prev, playerData];
                });
            }
        });

        socket.on('playerJoined', ({ userId }) => {
            toast.success('A player joined the room!');
        });

        socket.on('playerLeft', ({ userId }) => {
            toast('A player left the room');
        });

        socket.on('playerForfeited', ({ userId }) => {
            toast.error('A player forfeited!');
        });

        socket.on('cardPlayed', ({ card, playerId, newColor }) => {
            // Update will come through roomUpdated
        });

        socket.on('cardDrawn', ({ playerId }) => {
            // Update will come through roomUpdated
        });

        socket.on('unoCall', ({ userId, username }) => {
            toast(`${username} called UNO!`, { icon: '🎴' });
        });

        socket.on('gameStarted', () => {
            toast.success('Game started!');
        });

        socket.on('autoDrawn', ({ userId }) => {
            const player = players.find(p => p.user_id === userId);
            toast(`${player?.username || 'Player'} ran out of time and drew a card`);
        });

        socket.on('error', ({ message }) => {
            toast.error(message);
        });

        return () => {
            // Emit leaveRoom before disconnecting so player is properly removed
            socket.emit('leaveRoom', { roomId });
            socket.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [roomId, user?.id]);

    // Real-time updates are now handled exclusively through Socket.IO
    // The backend listens to Supabase changes and broadcasts via Socket.IO
    // This eliminates Supabase egress from the frontend entirely

    // Fetch initial room data
    useEffect(() => {
        if (!roomId) {
            setLoading(false);
            return;
        }

        const fetchRoom = async () => {
            try {
                const { data: roomData, error: roomError } = await supabase
                    .from('uno_rooms')
                    .select('*')
                    .eq('id', roomId)
                    .single();

                if (roomError) throw roomError;
                setRoom(roomData);

                const { data: playersData } = await supabase
                    .from('uno_players')
                    .select('*')
                    .eq('room_id', roomId);

                setPlayers(playersData || []);

                // Get my hand
                const myPlayerData = playersData?.find(p => String(p.user_id) === String(user?.id));
                if (myPlayerData?.hand) {
                    setMyHand(myPlayerData.hand);
                }

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchRoom();
    }, [roomId, user?.id]);

    // Create a new room
    const createRoom = useCallback(async (betAmount, maxPlayers = 4) => {
        try {
            const { data, error } = await supabase.rpc('fn_create_uno_room', {
                p_user_id: user.id,
                p_bet_amount: betAmount,
                p_max_players: maxPlayers
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Room created!');
            return { success: true, roomId: data.roomId };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [user?.id, refreshUser]);

    // Join a room
    const joinRoom = useCallback(async () => {
        if (!roomId) return { success: false, error: 'No room ID' };

        try {
            const { data, error } = await supabase.rpc('fn_join_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Joined room!');
            // Request room state broadcast to all players
            socketRef.current?.emit('requestRoomState', { roomId });
            return { success: true };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, refreshUser]);

    // Leave room
    const leaveRoom = useCallback(async () => {
        if (!roomId) return;

        try {
            const { data, error } = await supabase.rpc('fn_leave_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;

            socketRef.current?.emit('leaveRoom', { roomId });
            refreshUser();

            if (data.refunded) {
                toast.success('Bet refunded!');
            }

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id, refreshUser]);

    // Toggle ready status
    const toggleReady = useCallback(async () => {
        try {
            // Optimistic update - immediately update local state
            setPlayers(prev => prev.map(p =>
                String(p.user_id) === String(user?.id)
                    ? { ...p, is_ready: !p.is_ready }
                    : p
            ));

            const { data, error } = await supabase.rpc('fn_uno_toggle_ready', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            // Request room state broadcast via Socket.IO (no Supabase egress)
            socketRef.current?.emit('requestRoomState', { roomId });

        } catch (err) {
            toast.error(err.message);
            // Revert optimistic update on error - request fresh state
            socketRef.current?.emit('requestRoomState', { roomId });
        }
    }, [roomId, user?.id]);

    // Start game (host only)
    const startGame = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_start_uno_game', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            socketRef.current?.emit('gameStarted', { roomId });
            toast.success('Game started!');

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id]);

    // Delete room (host only)
    const deleteRoom = useCallback(async () => {
        try {
            const confirmed = window.confirm('Are you sure you want to delete this room? All players will be refunded.');
            if (!confirmed) return;

            const { data, error } = await supabase.rpc('fn_delete_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            toast.success('Room deleted! All players have been refunded.');
            navigate('/games/uno');

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id, navigate]);

    // Play a card
    const playCard = useCallback(async (cardIndex, wildColor = null) => {
        try {
            const { data, error } = await supabase.rpc('fn_uno_play_card', {
                p_user_id: user.id,
                p_room_id: roomId,
                p_card_index: cardIndex,
                p_wild_color: wildColor
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            // Emit to socket for live updates
            const playedCard = myHand[cardIndex];
            socketRef.current?.emit('cardPlayed', {
                roomId,
                card: playedCard,
                playerId: user?.id,
                newColor: wildColor || playedCard?.color
            });

            // Update local hand
            setMyHand(prev => prev.filter((_, i) => i !== cardIndex));

            // Check for game over
            if (data.gameOver) {
                refreshUser();
                toast.success(`🎉 You won $${data.winAmount}!`, { duration: 5000 });
            }

            return { success: true, ...data };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, myHand, refreshUser]);

    // Draw a card
    const drawCard = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_uno_draw_card', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            // Add drawn card to hand
            if (data.drawnCard) {
                setMyHand(prev => [...prev, data.drawnCard]);
            }

            socketRef.current?.emit('cardDrawn', { roomId, playerId: user?.id });

            return { success: true, card: data.drawnCard };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    // Call UNO
    const shoutUno = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_uno_call_uno', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            socketRef.current?.emit('unoCall', {
                roomId,
                userId: user?.id,
                username: user?.username
            });

            toast.success('UNO!', { icon: '🎴' });

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id, user?.username]);

    // Challenge UNO (not implemented yet - future feature)
    const challengeUno = useCallback(async (targetUserId) => {
        toast('Challenge feature coming soon!');
    }, []);

    // Check if a card can be played
    const isCardPlayable = useCallback((card) => {
        if (!room || !card) return false;

        // Wild cards can always be played
        if (card.type === 'wild') return true;

        // Match by color
        if (card.color === room.current_color) return true;

        // Match by value
        if (card.value === room.top_card?.value) return true;

        return false;
    }, [room]);

    return {
        room,
        players,
        myHand,
        loading,
        error,
        isMyTurn,
        currentPlayer,
        canCallUno,
        myPlayer,

        // Actions
        createRoom,
        joinRoom,
        leaveRoom,
        deleteRoom,
        toggleReady,
        startGame,
        playCard,
        drawCard,
        shoutUno,
        challengeUno,
        isCardPlayable,
    };
};

export default useUnoGame;
