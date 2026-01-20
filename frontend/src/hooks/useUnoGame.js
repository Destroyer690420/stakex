import { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * UNO Game Hook - Refactored with Strict Turn Logic
 * 
 * Key changes:
 * 1. isMyTurn computed using seat_index comparison (not player_order array lookup)
 * 2. currentTurnIndex exposed for timer key prop (forces timer remount)
 * 3. All turn-related state derived from single source: publicState.current_turn_index
 */
const useUnoGame = (roomId) => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    // ========================================
    // STATE
    // ========================================
    const [room, setRoom] = useState(null);
    const [publicState, setPublicState] = useState(null);
    const [players, setPlayers] = useState([]);
    const [myHand, setMyHand] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSending, setIsSending] = useState(false);

    const lastProcessedEvent = useRef(null);

    // ========================================
    // DERIVED VALUES - Single Source of Truth
    // ========================================

    // My player record from the players array
    const myPlayer = useMemo(() =>
        players.find(p => String(p.user_id) === String(user?.id)),
        [players, user?.id]
    );

    // My seat index (0-indexed position in the turn order)
    const mySeatIndex = myPlayer?.seat_index ?? -1;

    // Current turn index from Realtime (the authoritative source)
    const currentTurnIndex = publicState?.current_turn_index ?? -1;

    // Game status from Realtime
    const gameStatus = publicState?.status ?? 'waiting';

    /**
     * STRICT isMyTurn CHECK
     * Conditions:
     * 1. Game must be in 'playing' status
     * 2. My seat_index must match current_turn_index
     * 3. Both values must be valid (>= 0)
     */
    const isMyTurn = useMemo(() => {
        // Guard: Game must be playing
        if (gameStatus !== 'playing') return false;

        // Guard: Must have valid seat index
        if (mySeatIndex < 0 || currentTurnIndex < 0) return false;

        // Strict comparison
        return mySeatIndex === currentTurnIndex;
    }, [gameStatus, mySeatIndex, currentTurnIndex]);

    // Merged room object for backward compatibility
    const mergedRoom = useMemo(() => {
        if (!room || !publicState) return null;
        return {
            ...room,
            status: publicState.status,
            current_turn_index: publicState.current_turn_index,
            direction: publicState.direction,
            top_card: publicState.top_card,
            current_color: publicState.current_color,
            turn_started_at: publicState.turn_started_at,
            winner_id: publicState.winner_id,
            winner_username: publicState.winner_username,
        };
    }, [room, publicState]);

    // Current player's user_id (for display purposes)
    const currentPlayer = useMemo(() => {
        if (!room?.player_order || currentTurnIndex < 0) return null;
        return room.player_order[currentTurnIndex];
    }, [room?.player_order, currentTurnIndex]);

    // Current player's name (for display)
    const currentPlayerName = useMemo(() => {
        if (isMyTurn) return 'Your Turn';
        const player = players.find(p => String(p.user_id) === String(currentPlayer));
        return player?.username || 'Waiting...';
    }, [isMyTurn, currentPlayer, players]);

    const canCallUno = myHand.length <= 2 && myHand.length > 0;

    // ========================================
    // DATA FETCHING
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
        } catch (err) {
            console.error('[UNO] Failed to fetch room:', err);
            setError(err.message);
        }
    }, [roomId]);

    const fetchPublicState = useCallback(async () => {
        if (!roomId) return;
        try {
            const { data, error: fetchError } = await supabase
                .from('uno_public_states')
                .select('*')
                .eq('room_id', roomId)
                .single();

            if (fetchError) throw fetchError;
            setPublicState(data);
        } catch (err) {
            console.error('[UNO] Failed to fetch public state:', err);
        }
    }, [roomId]);

    const fetchPlayers = useCallback(async () => {
        if (!roomId) return;
        try {
            const { data, error: fetchError } = await supabase
                .from('uno_players')
                .select('*')
                .eq('room_id', roomId)
                .order('seat_index', { ascending: true });

            if (fetchError) throw fetchError;
            setPlayers(data || []);
        } catch (err) {
            console.error('[UNO] Failed to fetch players:', err);
        }
    }, [roomId]);

    const fetchMyHand = useCallback(async () => {
        if (!roomId || !user?.id) return;
        try {
            const { data, error: fetchError } = await supabase.rpc('fn_get_my_hand', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (fetchError) throw fetchError;
            setMyHand(data || []);
        } catch (err) {
            console.error('[UNO] Failed to fetch hand:', err);
        }
    }, [roomId, user?.id]);

    // ========================================
    // INITIAL DATA LOAD
    // ========================================
    useEffect(() => {
        if (!roomId) return;

        const loadInitialData = async () => {
            setLoading(true);
            setError(null);

            await Promise.all([
                fetchRoom(),
                fetchPublicState(),
                fetchPlayers(),
            ]);

            await fetchMyHand();
            setLoading(false);
        };

        loadInitialData();
    }, [roomId, fetchRoom, fetchPublicState, fetchPlayers, fetchMyHand]);

    // ========================================
    // REALTIME SUBSCRIPTION
    // ========================================
    useEffect(() => {
        if (!roomId || !user?.id) return;

        console.log('[UNO] Setting up Realtime subscription for room:', roomId);

        const channel = supabase
            .channel(`uno-game-${roomId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'uno_public_states',
                filter: `room_id=eq.${roomId}`
            }, async (payload) => {
                console.log('[UNO] Realtime event:', payload.eventType, payload.new?.last_event);

                if (payload.eventType === 'DELETE') {
                    toast.error('Room was closed');
                    navigate('/games/uno');
                    return;
                }

                const newState = payload.new;

                // CRITICAL: Update publicState immediately
                // This is the single source of truth for turn
                setPublicState(newState);

                // Dedupe events
                const eventKey = `${newState.last_event}-${newState.updated_at}`;
                if (eventKey === lastProcessedEvent.current) return;
                lastProcessedEvent.current = eventKey;

                // Handle specific events
                switch (newState.last_event) {
                    case 'game_started':
                        console.log('[UNO] Game started, fetching hand and players');
                        await fetchMyHand();
                        await fetchPlayers();
                        toast.success('Game started!');
                        break;

                    case 'card_played':
                    case 'card_drawn':
                        console.log('[UNO] Card action, refreshing data. New turn index:', newState.current_turn_index);
                        await fetchPlayers();
                        await fetchMyHand();
                        break;

                    case 'player_joined':
                        await fetchPlayers();
                        await fetchRoom();
                        toast.success('A player joined!');
                        break;

                    case 'player_left':
                        await fetchPlayers();
                        await fetchRoom();
                        toast('A player left');
                        break;

                    case 'player_ready':
                        await fetchPlayers();
                        break;

                    case 'uno_called':
                        if (String(newState.last_event_user_id) !== String(user.id)) {
                            const caller = players.find(p => String(p.user_id) === String(newState.last_event_user_id));
                            toast(`${caller?.username || 'Player'} called UNO!`, { icon: '🎴' });
                        }
                        break;

                    case 'game_over':
                        await fetchPlayers();
                        refreshUser();
                        if (String(newState.winner_id) === String(user.id)) {
                            toast.success('🎉 You won!', { duration: 5000 });
                        } else {
                            toast(`${newState.winner_username} won the game!`);
                        }
                        break;

                    default:
                        break;
                }
            })
            .subscribe();

        return () => {
            console.log('[UNO] Cleaning up Realtime subscription');
            channel.unsubscribe();
        };
    }, [roomId, user?.id, navigate, fetchRoom, fetchPlayers, fetchMyHand, refreshUser, players]);

    // ========================================
    // GAME ACTIONS with Safety Guards
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

            await fetchPlayers();
            return { success: true, isReady: data.isReady };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, fetchPlayers]);

    const startGame = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_start_uno_game', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    /**
     * PLAY CARD - With Safety Guard
     */
    const playCard = useCallback(async (cardIndex, wildColor = null) => {
        // SAFETY CHECK: Verify it's actually our turn
        if (!isMyTurn) {
            console.warn('[UNO] playCard called but isMyTurn is false. Aborting.');
            toast.error("Not your turn!");
            return { success: false, error: 'Not your turn' };
        }

        if (!roomId || !user?.id) return { success: false };
        if (isSending) return { success: false, error: 'Already sending' };

        setIsSending(true);

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_uno_play_card', {
                p_user_id: user.id,
                p_room_id: roomId,
                p_card_index: cardIndex,
                p_wild_color: wildColor
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            // Optimistic update
            setMyHand(prev => prev.filter((_, i) => i !== cardIndex));

            if (data.gameOver) {
                refreshUser();
            }

            return { success: true, data };
        } catch (err) {
            toast.error(err.message);
            await fetchMyHand();
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, isSending, isMyTurn, refreshUser, fetchMyHand]);

    /**
     * DRAW CARD - With Safety Guard
     */
    const drawCard = useCallback(async () => {
        // SAFETY CHECK: Verify it's actually our turn
        if (!isMyTurn) {
            console.warn('[UNO] drawCard called but isMyTurn is false. Aborting.');
            return { success: false, error: 'Not your turn' };
        }

        if (!roomId || !user?.id) return { success: false };
        if (isSending) return { success: false, error: 'Already sending' };

        setIsSending(true);

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_uno_draw_card', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            if (data.drawnCard) {
                setMyHand(prev => [...prev, data.drawnCard]);
            }

            return { success: true, data };
        } catch (err) {
            toast.error(err.message);
            await fetchMyHand();
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, isSending, isMyTurn, fetchMyHand]);

    const shoutUno = useCallback(async () => {
        if (!roomId || !user?.id) return { success: false };

        try {
            const { data, error: rpcError } = await supabase.rpc('fn_uno_call_uno', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (rpcError) throw rpcError;
            if (!data.success) throw new Error(data.error);

            toast.success('UNO!', { icon: '🎴' });
            return { success: true };
        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id]);

    const challengeUno = useCallback(async (targetUserId) => {
        toast('Challenge feature coming soon!');
        return { success: false };
    }, []);

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================
    const isCardPlayable = useCallback((card) => {
        if (!publicState || !card) return false;
        if (card.type === 'wild') return true;
        if (card.color === publicState.current_color) return true;
        if (card.value === publicState.top_card?.value) return true;
        return false;
    }, [publicState]);

    // ========================================
    // RETURN - Expose currentTurnIndex for timer key
    // ========================================
    return {
        room: mergedRoom,
        publicState,
        players,
        myHand,
        loading,
        error,

        // Turn state - CRITICAL for UI
        isMyTurn,
        currentTurnIndex,        // Expose for timer key prop
        currentPlayer,
        currentPlayerName,       // Pre-computed for display
        mySeatIndex,             // Expose for debugging
        gameStatus,

        canCallUno,
        myPlayer,
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
        challengeUno,
        isCardPlayable,
    };
};

export default useUnoGame;
