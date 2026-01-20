import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';

/**
 * UNO Game Hook - Split State Architecture
 * 
 * Key optimizations:
 * 1. Subscribes ONLY to uno_public_states (~100 bytes per update)
 * 2. NO polling - pure Realtime subscription
 * 3. Fetches hand via fn_get_my_hand RPC only when needed
 * 4. Optimistic UI for card plays
 */
const useUnoGame = (roomId) => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    // Public state (from Realtime subscription)
    const [publicState, setPublicState] = useState(null);
    const [room, setRoom] = useState(null);
    const [players, setPlayers] = useState([]);

    // Private state (fetched on demand)
    const [myHand, setMyHand] = useState([]);

    // UI state
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isSending, setIsSending] = useState(false);

    // Track last fetched event to avoid redundant hand fetches
    const lastFetchedEventRef = useRef(null);

    // Computed values
    const isMyTurn = String(room?.player_order?.[publicState?.current_turn_index]) === String(user?.id);
    const currentPlayer = room?.player_order?.[publicState?.current_turn_index];
    const canCallUno = myHand.length <= 2 && myHand.length > 0;
    const myPlayer = players.find(p => String(p.user_id) === String(user?.id));

    // Merge public state into a room-like object for backwards compatibility
    const mergedRoom = room && publicState ? {
        ...room,
        status: publicState.status,
        current_turn_index: publicState.current_turn_index,
        direction: publicState.direction,
        top_card: publicState.top_card,
        current_color: publicState.current_color,
        turn_started_at: publicState.turn_started_at,
        winner_id: publicState.winner_id,
        winner_username: publicState.winner_username,
    } : null;

    // ========================================
    // FETCH MY HAND (Lightweight RPC)
    // ========================================
    const fetchMyHand = useCallback(async () => {
        if (!roomId || !user?.id) return;

        try {
            const { data, error } = await supabase.rpc('fn_get_my_hand', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            setMyHand(data || []);
        } catch (err) {
            console.error('Failed to fetch hand:', err);
        }
    }, [roomId, user?.id]);

    // ========================================
    // FETCH PLAYERS (Non-realtime, on demand)
    // ========================================
    const fetchPlayers = useCallback(async () => {
        if (!roomId) return;

        try {
            const { data, error } = await supabase
                .from('uno_players')
                .select('*')
                .eq('room_id', roomId);

            if (error) throw error;
            setPlayers(data || []);
        } catch (err) {
            console.error('Failed to fetch players:', err);
        }
    }, [roomId]);

    // ========================================
    // INITIAL DATA FETCH
    // ========================================
    useEffect(() => {
        if (!roomId) {
            setLoading(false);
            return;
        }

        const fetchInitialData = async () => {
            try {
                // Fetch room metadata
                const { data: roomData, error: roomError } = await supabase
                    .from('uno_rooms')
                    .select('*')
                    .eq('id', roomId)
                    .single();

                if (roomError) throw roomError;
                setRoom(roomData);

                // Fetch public state
                const { data: publicData, error: publicError } = await supabase
                    .from('uno_public_states')
                    .select('*')
                    .eq('room_id', roomId)
                    .single();

                if (publicError) throw publicError;
                setPublicState(publicData);

                // Fetch players
                await fetchPlayers();

                // Fetch my hand if game is in progress
                if (publicData?.status === 'playing') {
                    await fetchMyHand();
                }

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchInitialData();
    }, [roomId, fetchPlayers, fetchMyHand]);

    // ========================================
    // REALTIME SUBSCRIPTION (Public State ONLY!)
    // ========================================
    useEffect(() => {
        if (!roomId || !user?.id) return;

        const subscription = supabase
            .channel(`uno-public-${roomId}`)
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

                // Handle different events
                const eventKey = `${newState.last_event}-${newState.updated_at}`;

                if (eventKey !== lastFetchedEventRef.current) {
                    lastFetchedEventRef.current = eventKey;

                    switch (newState.last_event) {
                        case 'game_started':
                            // Everyone needs their hand
                            await fetchMyHand();
                            await fetchPlayers();
                            toast.success('Game started!');
                            break;

                        case 'card_played':
                        case 'card_drawn':
                            // Always fetch players to update opponent hand counts
                            await fetchPlayers();

                            // Fetch hand only if it was MY action or I'm the victim of +2/+4
                            if (newState.last_event_user_id === user.id) {
                                // My own action - hand already updated optimistically
                                // But fetch to ensure sync
                                await fetchMyHand();
                            } else {
                                // Someone else played - only fetch if I might have received cards
                                const myIndex = room?.player_order?.indexOf(user.id);
                                const currentIndex = newState.current_turn_index;
                                // If it's now my turn after a +2/+4, I need to refresh
                                if (myIndex === currentIndex) {
                                    await fetchMyHand();
                                }
                            }
                            break;

                        case 'player_joined':
                        case 'player_left':
                            await fetchPlayers();
                            // Refetch room to get updated player_order
                            const { data: roomData } = await supabase
                                .from('uno_rooms')
                                .select('*')
                                .eq('id', roomId)
                                .single();
                            if (roomData) setRoom(roomData);

                            if (newState.last_event === 'player_joined') {
                                toast.success('A player joined the room!');
                            } else {
                                toast('A player left the room');
                            }
                            break;

                        case 'player_ready':
                            await fetchPlayers();
                            break;

                        case 'uno_called':
                            if (newState.last_event_user_id !== user.id) {
                                const caller = players.find(p => p.user_id === newState.last_event_user_id);
                                toast(`${caller?.username || 'Player'} called UNO!`, { icon: '🎴' });
                            }
                            break;

                        case 'game_over':
                            await fetchPlayers();
                            refreshUser();
                            if (newState.winner_id === user.id) {
                                toast.success(`🎉 You won!`, { duration: 5000 });
                            } else {
                                toast(`${newState.winner_username} won the game!`);
                            }
                            break;

                        default:
                            break;
                    }
                }
            })
            .subscribe();

        return () => {
            subscription.unsubscribe();
        };
    }, [roomId, user?.id, navigate, fetchMyHand, fetchPlayers, room?.player_order, players, refreshUser]);

    // ========================================
    // ROOM ACTIONS
    // ========================================

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
            return { success: true };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        }
    }, [roomId, user?.id, refreshUser]);

    const leaveRoom = useCallback(async () => {
        if (!roomId) return;

        try {
            const { data, error } = await supabase.rpc('fn_leave_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;

            refreshUser();

            if (data.refunded) {
                toast.success('Bet refunded!');
            }

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id, refreshUser]);

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

    const toggleReady = useCallback(async () => {
        try {
            // Optimistic update
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

        } catch (err) {
            toast.error(err.message);
            // Revert on error
            await fetchPlayers();
        }
    }, [roomId, user?.id, fetchPlayers]);

    const startGame = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_start_uno_game', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            // Hand will be fetched via Realtime subscription when game_started event fires

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id]);

    // ========================================
    // GAMEPLAY ACTIONS (with Optimistic UI)
    // ========================================

    const playCard = useCallback(async (cardIndex, wildColor = null) => {
        if (isSending) return { success: false, error: 'Already sending' };

        // Get the card before removing
        const playedCard = myHand[cardIndex];
        if (!playedCard) return { success: false, error: 'Invalid card' };

        try {
            // OPTIMISTIC UI: Remove card immediately
            setIsSending(true);
            setMyHand(prev => prev.filter((_, i) => i !== cardIndex));

            const { data, error } = await supabase.rpc('fn_uno_play_card', {
                p_user_id: user.id,
                p_room_id: roomId,
                p_card_index: cardIndex,
                p_wild_color: wildColor
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            // Check for game over
            if (data.gameOver) {
                refreshUser();
                toast.success(`🎉 You won $${data.winAmount}!`, { duration: 5000 });
            }

            return { success: true, ...data };

        } catch (err) {
            // REVERT on error: Put card back
            setMyHand(prev => {
                const newHand = [...prev];
                newHand.splice(cardIndex, 0, playedCard);
                return newHand;
            });
            toast.error(err.message);
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, myHand, refreshUser, isSending]);

    const drawCard = useCallback(async () => {
        if (isSending) return { success: false, error: 'Already sending' };

        try {
            setIsSending(true);

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

            return { success: true, card: data.drawnCard };

        } catch (err) {
            toast.error(err.message);
            return { success: false, error: err.message };
        } finally {
            setIsSending(false);
        }
    }, [roomId, user?.id, isSending]);

    const shoutUno = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_uno_call_uno', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            toast.success('UNO!', { icon: '🎴' });

        } catch (err) {
            toast.error(err.message);
        }
    }, [roomId, user?.id]);

    const challengeUno = useCallback(async (targetUserId) => {
        toast('Challenge feature coming soon!');
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

    return {
        // Use merged room for backwards compatibility
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
