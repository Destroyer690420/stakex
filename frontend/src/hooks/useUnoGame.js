import { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * UNO Game Hook - Complete Rewrite
 * 
 * Architecture:
 * - Realtime subscription to uno_public_states (lightweight)
 * - On-demand fetches for hand and players
 * - Optimistic UI updates for smoother UX
 */
const useUnoGame = (roomId) => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    // ========================================
    // STATE
    // ========================================
    const [room, setRoom] = useState(null);           // uno_rooms data
    const [publicState, setPublicState] = useState(null); // uno_public_states data
    const [players, setPlayers] = useState([]);       // uno_players data
    const [myHand, setMyHand] = useState([]);         // Player's cards
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSending, setIsSending] = useState(false);

    // Refs to track processed events
    const lastProcessedEvent = useRef(null);

    // ========================================
    // COMPUTED VALUES
    // ========================================
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

    const isMyTurn = useMemo(() => {
        if (!mergedRoom?.player_order || publicState?.current_turn_index === undefined) return false;
        const currentPlayerId = mergedRoom.player_order[publicState.current_turn_index];
        return String(currentPlayerId) === String(user?.id);
    }, [mergedRoom?.player_order, publicState?.current_turn_index, user?.id]);

    const currentPlayer = useMemo(() => {
        if (!mergedRoom?.player_order || publicState?.current_turn_index === undefined) return null;
        return mergedRoom.player_order[publicState.current_turn_index];
    }, [mergedRoom?.player_order, publicState?.current_turn_index]);

    const canCallUno = myHand.length <= 2 && myHand.length > 0;
    const myPlayer = players.find(p => String(p.user_id) === String(user?.id));

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
            console.error('Failed to fetch room:', err);
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
            console.error('Failed to fetch public state:', err);
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
            console.error('Failed to fetch players:', err);
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
            console.error('Failed to fetch hand:', err);
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

            // Fetch hand after we know the game state
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

        const channel = supabase
            .channel(`uno-game-${roomId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'uno_public_states',
                filter: `room_id=eq.${roomId}`
            }, async (payload) => {
                if (payload.eventType === 'DELETE') {
                    toast.error('Room was closed');
                    navigate('/games/uno');
                    return;
                }

                const newState = payload.new;
                setPublicState(newState);

                // Create unique event key to avoid duplicate processing
                const eventKey = `${newState.last_event}-${newState.updated_at}`;
                if (eventKey === lastProcessedEvent.current) return;
                lastProcessedEvent.current = eventKey;

                // Handle events
                switch (newState.last_event) {
                    case 'game_started':
                        await fetchMyHand();
                        await fetchPlayers();
                        toast.success('Game started!');
                        break;

                    case 'card_played':
                    case 'card_drawn':
                        // Always refresh players to get updated hand counts
                        await fetchPlayers();
                        // Refresh hand if I was involved
                        await fetchMyHand();
                        break;

                    case 'player_joined':
                        await fetchPlayers();
                        await fetchRoom(); // Get updated player_order
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
            channel.unsubscribe();
        };
    }, [roomId, user?.id, navigate, fetchRoom, fetchPlayers, fetchMyHand, refreshUser, players]);

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

    const playCard = useCallback(async (cardIndex, wildColor = null) => {
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

            // Update hand optimistically
            setMyHand(prev => prev.filter((_, i) => i !== cardIndex));

            if (data.gameOver) {
                refreshUser();
            }

            return { success: true, data };
        } catch (err) {
            toast.error(err.message);
            // Refetch hand on error
            await fetchMyHand();
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, isSending, refreshUser, fetchMyHand]);

    const drawCard = useCallback(async () => {
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

            // Add drawn card to hand
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
    }, [roomId, user?.id, isSending, fetchMyHand]);

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
        // Placeholder for UNO challenge feature
        toast('Challenge feature coming soon!');
        return { success: false };
    }, []);

    // ========================================
    // UTILITY FUNCTIONS
    // ========================================
    const isCardPlayable = useCallback((card) => {
        if (!publicState || !card) return false;

        // Wild cards can always be played
        if (card.type === 'wild') return true;

        // Match by color
        if (card.color === publicState.current_color) return true;

        // Match by value
        if (card.value === publicState.top_card?.value) return true;

        return false;
    }, [publicState]);

    // ========================================
    // RETURN VALUE
    // ========================================
    return {
        room: mergedRoom,
        publicState,
        players,
        myHand,
        loading,
        error,
        isMyTurn,
        currentPlayer,
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
