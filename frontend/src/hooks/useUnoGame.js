import { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * UNO GAME HOOK - COMPLETE REBUILD
 * 
 * Architecture:
 * - Single subscription to uno_rooms table
 * - All state in one place (players, hands, deck, discard)
 * - Timer syncs to current_turn_index changes
 */
const useUnoGame = (roomId) => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    // ========================================
    // STATE - Single source of truth
    // ========================================
    const [room, setRoom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSending, setIsSending] = useState(false);

    // Timer state
    const [turnTimeLeft, setTurnTimeLeft] = useState(15);
    const timerRef = useRef(null);
    const autoDrawnRef = useRef(false);

    // ========================================
    // DERIVED VALUES
    // ========================================

    // Find my player in the players array
    const myPlayer = useMemo(() => {
        if (!room?.players || !user?.id) return null;
        return room.players.find(p => p.user_id === user.id);
    }, [room?.players, user?.id]);

    // My seat index
    const mySeatIndex = myPlayer?.seat_index ?? -1;

    // Current turn index
    const currentTurnIndex = room?.current_turn_index ?? -1;

    // Is it my turn?
    const isMyTurn = useMemo(() => {
        if (room?.status !== 'playing') return false;
        if (mySeatIndex < 0 || currentTurnIndex < 0) return false;
        return mySeatIndex === currentTurnIndex;
    }, [room?.status, mySeatIndex, currentTurnIndex]);

    // My hand (from players array)
    const myHand = myPlayer?.hand ?? [];

    // Current player's name
    const currentPlayerName = useMemo(() => {
        if (isMyTurn) return 'Your Turn';
        const player = room?.players?.[currentTurnIndex];
        return player?.username ?? 'Waiting...';
    }, [isMyTurn, room?.players, currentTurnIndex]);

    // All players (for display)
    const players = room?.players ?? [];

    // Opponents
    const opponents = useMemo(() =>
        players.filter(p => p.user_id !== user?.id),
        [players, user?.id]
    );

    // Top card on discard pile
    const topCard = useMemo(() => {
        if (!room?.discard_pile?.length) return null;
        return room.discard_pile[room.discard_pile.length - 1];
    }, [room?.discard_pile]);

    // Can call UNO
    const canCallUno = myHand.length <= 2 && myHand.length > 0;

    // ========================================
    // FETCH ROOM
    // ========================================
    const fetchRoom = useCallback(async () => {
        if (!roomId) return;

        try {
            const { data, error: fetchError } = await supabase
                .from('uno_rooms')
                .select('*')
                .eq('id', roomId)
                .single();

            if (fetchError) throw fetchError;
            setRoom(data);
            setError(null);
        } catch (err) {
            console.error('[UNO] Fetch error:', err);
            setError(err.message);
        }
    }, [roomId]);

    // ========================================
    // INITIAL LOAD
    // ========================================
    useEffect(() => {
        if (!roomId) return;

        const loadRoom = async () => {
            setLoading(true);
            await fetchRoom();
            setLoading(false);
        };

        loadRoom();
    }, [roomId, fetchRoom]);

    // ========================================
    // REALTIME SUBSCRIPTION - Single subscription to uno_rooms
    // ========================================
    useEffect(() => {
        if (!roomId) return;

        console.log('[UNO] Setting up Realtime subscription');

        const channel = supabase
            .channel(`uno-room-${roomId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'uno_rooms',
                filter: `id=eq.${roomId}`
            }, (payload) => {
                console.log('[UNO] Realtime update:', payload.eventType);

                if (payload.eventType === 'DELETE') {
                    toast.error('Room was deleted');
                    navigate('/games/uno');
                    return;
                }

                // Update room state with new data
                const newRoom = payload.new;
                setRoom(newRoom);

                // Handle game over
                if (newRoom.status === 'finished' && newRoom.winner_id) {
                    if (newRoom.winner_id === user?.id) {
                        toast.success('🎉 You won!');
                        refreshUser();
                    } else {
                        toast(`${newRoom.winner_username} won the game!`);
                    }
                }
            })
            .subscribe();

        return () => {
            console.log('[UNO] Cleaning up subscription');
            channel.unsubscribe();
        };
    }, [roomId, navigate, user?.id, refreshUser]);

    // ========================================
    // TIMER - Syncs to current_turn_index changes
    // ========================================
    useEffect(() => {
        // Clear any existing timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        // Only run during active game
        if (room?.status !== 'playing') {
            setTurnTimeLeft(15);
            return;
        }

        // Reset timer when turn changes
        console.log('[UNO] Turn changed to:', currentTurnIndex, 'isMyTurn:', isMyTurn);
        setTurnTimeLeft(15);
        autoDrawnRef.current = false;

        // Start countdown
        timerRef.current = setInterval(() => {
            setTurnTimeLeft(prev => {
                if (prev <= 1) {
                    // Time's up - auto draw if it's my turn
                    if (isMyTurn && !autoDrawnRef.current) {
                        autoDrawnRef.current = true;
                        console.log('[UNO] Timer expired, auto-drawing');
                        // Execute in next tick
                        setTimeout(() => {
                            drawCardInternal().catch(console.error);
                        }, 0);
                    }
                    return 15;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [currentTurnIndex, room?.status, isMyTurn]);

    // ========================================
    // GAME ACTIONS
    // ========================================

    const createRoom = useCallback(async (betAmount, maxPlayers = 4) => {
        if (!user?.id) {
            toast.error('Please log in');
            return { success: false };
        }

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_create_uno_room', {
                p_user_id: user.id,
                p_bet_amount: betAmount,
                p_max_players: maxPlayers
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Room created!');
            return { success: true, roomId: data.roomId };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [user?.id, refreshUser]);

    const joinRoom = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_join_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            if (!data.alreadyInRoom) {
                toast.success('Joined room!');
            }
            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, refreshUser]);

    const leaveRoom = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_leave_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, refreshUser]);

    const deleteRoom = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_delete_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Room deleted');
            navigate('/games/uno');
            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, refreshUser, navigate]);

    const toggleReady = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_uno_toggle_ready', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            return { success: true, isReady: data.isReady };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    const startGame = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_start_uno', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            toast.success('Game started!');
            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    const playCard = useCallback(async (cardIndex, wildColor = null) => {
        // Safety check
        if (!isMyTurn) {
            console.warn('[UNO] playCard called but not my turn');
            toast.error("Not your turn!");
            return { success: false };
        }

        if (!roomId || !user?.id || isSending) return { success: false };

        setIsSending(true);

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_play_card', {
                p_user_id: user.id,
                p_room_id: roomId,
                p_card_index: cardIndex,
                p_wild_color: wildColor
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            if (data.gameOver) {
                refreshUser();
            }

            return { success: true, data };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, isMyTurn, isSending, refreshUser]);

    // Internal draw card (for auto-draw, doesn't check isMyTurn again)
    const drawCardInternal = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_draw_card', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            return { success: true, data };
        } catch (err) {
            console.error('[UNO] Draw failed:', err);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    const drawCard = useCallback(async () => {
        // Safety check
        if (!isMyTurn) {
            toast.error("Not your turn!");
            return { success: false };
        }

        if (isSending) return { success: false };
        setIsSending(true);

        const result = await drawCardInternal();

        setIsSending(false);
        return result;
    }, [isMyTurn, isSending, drawCardInternal]);

    const shoutUno = useCallback(async () => {
        toast.success('UNO!', { icon: '🎴' });
        return { success: true };
    }, []);

    // ========================================
    // UTILITY
    // ========================================
    const isCardPlayable = useCallback((card) => {
        if (!topCard || !card) return false;
        if (card.type === 'wild') return true;
        if (card.color === room?.current_color) return true;
        if (card.value === topCard.value) return true;
        return false;
    }, [topCard, room?.current_color]);

    // ========================================
    // RETURN
    // ========================================
    return {
        room,
        loading,
        error,

        // Players
        players,
        opponents,
        myPlayer,
        myHand,

        // Turn state
        isMyTurn,
        currentTurnIndex,
        currentPlayerName,
        mySeatIndex,
        turnTimeLeft,

        // Game state
        topCard,
        currentColor: room?.current_color,
        gameStatus: room?.status ?? 'waiting',
        canCallUno,
        isSending,

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
        isCardPlayable,
    };
};

export default useUnoGame;
