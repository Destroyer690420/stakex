import { useState, useCallback, useContext, useRef, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { AuthContext } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
    createDeck,
    shuffleDeck,
    dealRound,
    calculateRoundResult,
    generateAnimationQueue
} from '../lib/baccaratEngine';

/**
 * useBaccarat Hook
 * 
 * Hybrid state management for Baccarat game
 * - Singleplayer: Pure local logic, single RPC at end for balance sync
 * - Multiplayer: WebSocket sync via Supabase Realtime
 * 
 * CRITICAL: NO network requests during betting/idle phase
 */

const INITIAL_BETS = {
    player: 0,
    banker: 0,
    tie: 0
};

const CHIP_VALUES = [1, 5, 10, 25, 50, 100, 500];

export default function useBaccarat() {
    const { user, refreshUser } = useContext(AuthContext);

    // Game phase: 'betting' | 'dealing' | 'result'
    const [gameState, setGameState] = useState('betting');

    // Bet tracking (local only during betting phase)
    const [bets, setBets] = useState({ ...INITIAL_BETS });
    const [previousBets, setPreviousBets] = useState({ ...INITIAL_BETS });
    const [selectedChip, setSelectedChip] = useState(10);

    // Card state
    const [playerCards, setPlayerCards] = useState([]);
    const [bankerCards, setBankerCards] = useState([]);
    const [playerScore, setPlayerScore] = useState(0);
    const [bankerScore, setBankerScore] = useState(0);

    // Result
    const [winner, setWinner] = useState(null);
    const [roundResult, setRoundResult] = useState(null);

    // Animation
    const [visiblePlayerCards, setVisiblePlayerCards] = useState([]);
    const [visibleBankerCards, setVisibleBankerCards] = useState([]);
    const [isAnimating, setIsAnimating] = useState(false);
    const animationTimeoutRef = useRef(null);

    // Deck (local for singleplayer)
    const deckRef = useRef(shuffleDeck(createDeck()));

    // Multiplayer state
    const [isMultiplayer, setIsMultiplayer] = useState(false);
    const [roomCode, setRoomCode] = useState(null);
    const channelRef = useRef(null);

    // Loading state
    const [isProcessing, setIsProcessing] = useState(false);

    // Calculate total bet
    const totalBet = bets.player + bets.banker + bets.tie;
    const canDeal = totalBet > 0 && gameState === 'betting' && !isProcessing;
    const canClear = totalBet > 0 && gameState === 'betting';
    const canRebet = previousBets.player + previousBets.banker + previousBets.tie > 0 &&
        gameState === 'betting' &&
        totalBet === 0;

    /**
     * Place a bet on a zone
     * NO network calls - purely local state update
     */
    const placeBet = useCallback((zone, amount = null) => {
        if (gameState !== 'betting') return;

        const betAmount = amount || selectedChip;
        const currentTotal = bets.player + bets.banker + bets.tie;
        const userBalance = user?.cash || 0;

        // Check if user has enough balance
        if (currentTotal + betAmount > userBalance) {
            toast.error('Insufficient balance');
            return;
        }

        setBets(prev => ({
            ...prev,
            [zone]: prev[zone] + betAmount
        }));
    }, [gameState, selectedChip, bets, user?.cash]);

    /**
     * Remove bet from a zone
     */
    const removeBet = useCallback((zone) => {
        if (gameState !== 'betting') return;

        setBets(prev => ({
            ...prev,
            [zone]: Math.max(0, prev[zone] - selectedChip)
        }));
    }, [gameState, selectedChip]);

    /**
     * Clear all bets
     */
    const clearBets = useCallback(() => {
        if (gameState !== 'betting') return;
        setBets({ ...INITIAL_BETS });
    }, [gameState]);

    /**
     * Restore previous round bets
     */
    const rebet = useCallback(() => {
        if (gameState !== 'betting') return;

        const prevTotal = previousBets.player + previousBets.banker + previousBets.tie;
        const userBalance = user?.cash || 0;

        if (prevTotal > userBalance) {
            toast.error('Insufficient balance for rebet');
            return;
        }

        setBets({ ...previousBets });
    }, [gameState, previousBets, user?.cash]);

    /**
     * Run card animation sequence
     */
    const runAnimations = useCallback((animQueue, pCards, bCards) => {
        setIsAnimating(true);
        setVisiblePlayerCards([]);
        setVisibleBankerCards([]);

        animQueue.forEach((item, index) => {
            animationTimeoutRef.current = setTimeout(() => {
                if (item.type.startsWith('PLAYER_CARD')) {
                    const cardIndex = parseInt(item.type.split('_')[2]) - 1;
                    setVisiblePlayerCards(prev => [...prev, pCards[cardIndex]]);
                } else if (item.type.startsWith('BANKER_CARD')) {
                    const cardIndex = parseInt(item.type.split('_')[2]) - 1;
                    setVisibleBankerCards(prev => [...prev, bCards[cardIndex]]);
                } else if (item.type === 'RESULT') {
                    setIsAnimating(false);
                    setGameState('result');
                }
            }, item.delay);
        });
    }, []);

    /**
     * Deal cards - main game action
     * SINGLEPLAYER: Run locally, then single RPC for balance
     */
    const deal = useCallback(async () => {
        if (!canDeal || !user) return;

        setIsProcessing(true);
        setGameState('dealing');

        // Save bets for rebet feature
        setPreviousBets({ ...bets });

        try {
            // Deal round locally using the engine
            const result = dealRound(deckRef.current);

            // Update deck reference
            deckRef.current = result.remainingDeck;

            // Store card data
            setPlayerCards(result.playerCards);
            setBankerCards(result.bankerCards);
            setPlayerScore(result.playerScore);
            setBankerScore(result.bankerScore);
            setWinner(result.winner);

            // Calculate payouts
            const roundRes = calculateRoundResult(bets, result.winner);
            setRoundResult(roundRes);

            // Generate and run animations
            const animQueue = generateAnimationQueue(result.playerCards, result.bankerCards);
            runAnimations(animQueue, result.playerCards, result.bankerCards);

            // SINGLE RPC CALL - only after round is complete
            // Wait for animations to finish
            const totalAnimTime = animQueue[animQueue.length - 1].delay + 500;

            setTimeout(async () => {
                try {
                    const { data, error } = await supabase.rpc('fn_baccarat_settle_sp', {
                        p_user_id: user.id,
                        p_total_bet: roundRes.totalBet,
                        p_total_payout: roundRes.totalPayout,
                        p_total_profit: roundRes.totalProfit,
                        p_winner: result.winner,
                        p_game_data: {
                            bets,
                            playerScore: result.playerScore,
                            bankerScore: result.bankerScore,
                            playerCards: result.playerCards,
                            bankerCards: result.bankerCards
                        }
                    });

                    if (error) throw error;

                    if (!data.success) {
                        console.error('Settle error:', data.error);
                        toast.error(data.error || 'Failed to update balance');
                    } else {
                        // Refresh user balance
                        refreshUser();

                        // Show result toast
                        if (roundRes.totalProfit > 0) {
                            toast.success(`You won $${roundRes.totalProfit.toFixed(2)}!`, {
                                duration: 3000,
                                style: {
                                    background: '#0f0f0f',
                                    color: '#00e701',
                                    border: '1px solid #00e701'
                                }
                            });
                        } else if (roundRes.totalProfit < 0) {
                            toast.error(`You lost $${Math.abs(roundRes.totalProfit).toFixed(2)}`, {
                                duration: 3000
                            });
                        } else {
                            toast('Push - bets returned', {
                                duration: 3000,
                                icon: '🔄'
                            });
                        }
                    }
                } catch (err) {
                    console.error('RPC error:', err);
                    toast.error('Failed to sync balance');
                }

                setIsProcessing(false);
            }, totalAnimTime);

        } catch (error) {
            console.error('Deal error:', error);
            toast.error('Failed to deal cards');
            setGameState('betting');
            setIsProcessing(false);
        }
    }, [canDeal, user, bets, runAnimations, refreshUser]);

    /**
     * Start a new round
     */
    const newRound = useCallback(() => {
        setGameState('betting');
        setBets({ ...INITIAL_BETS });
        setPlayerCards([]);
        setBankerCards([]);
        setVisiblePlayerCards([]);
        setVisibleBankerCards([]);
        setPlayerScore(0);
        setBankerScore(0);
        setWinner(null);
        setRoundResult(null);

        // Reshuffle if deck is low
        if (deckRef.current.length < 20) {
            deckRef.current = shuffleDeck(createDeck());
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (animationTimeoutRef.current) {
                clearTimeout(animationTimeoutRef.current);
            }
            if (channelRef.current) {
                supabase.removeChannel(channelRef.current);
            }
        };
    }, []);

    // ============================================
    // MULTIPLAYER FUNCTIONS (Future implementation)
    // ============================================

    const joinRoom = useCallback(async (code) => {
        if (!user) return;

        try {
            const { data, error } = await supabase.rpc('fn_baccarat_join_room', {
                p_user_id: user.id,
                p_room_code: code
            });

            if (error) throw error;
            if (!data.success) {
                toast.error(data.error);
                return false;
            }

            // Initialize Realtime channel
            channelRef.current = supabase.channel(`baccarat_room_${data.roomId}`)
                .on('broadcast', { event: 'bet_placed' }, ({ payload }) => {
                    // Handle other players' bets
                    console.log('Bet placed:', payload);
                })
                .on('broadcast', { event: 'deal_start' }, ({ payload }) => {
                    // Sync deal animation
                    console.log('Deal started:', payload);
                })
                .on('broadcast', { event: 'round_end' }, ({ payload }) => {
                    // Show result and refresh balance
                    console.log('Round ended:', payload);
                    refreshUser();
                })
                .subscribe();

            setRoomCode(data.roomCode);
            setIsMultiplayer(true);
            toast.success(`Joined room ${data.roomCode}`);
            return true;

        } catch (error) {
            console.error('Join room error:', error);
            toast.error('Failed to join room');
            return false;
        }
    }, [user, refreshUser]);

    const leaveRoom = useCallback(() => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        }
        setRoomCode(null);
        setIsMultiplayer(false);
        newRound();
    }, [newRound]);

    const createRoom = useCallback(async (minBet = 10, maxBet = 1000) => {
        if (!user) return null;

        try {
            const { data, error } = await supabase.rpc('fn_baccarat_create_room', {
                p_user_id: user.id,
                p_min_bet: minBet,
                p_max_bet: maxBet
            });

            if (error) throw error;
            if (!data.success) {
                toast.error(data.error);
                return null;
            }

            // Auto-join the room we created
            await joinRoom(data.roomCode);
            return data.roomCode;

        } catch (error) {
            console.error('Create room error:', error);
            toast.error('Failed to create room');
            return null;
        }
    }, [user, joinRoom]);

    return {
        // State
        gameState,
        bets,
        selectedChip,
        playerCards: visiblePlayerCards,
        bankerCards: visibleBankerCards,
        playerScore,
        bankerScore,
        winner,
        roundResult,
        isAnimating,
        isProcessing,
        totalBet,

        // Multiplayer
        isMultiplayer,
        roomCode,

        // Flags
        canDeal,
        canClear,
        canRebet,

        // Actions
        placeBet,
        removeBet,
        clearBets,
        rebet,
        setSelectedChip,
        deal,
        newRound,

        // Multiplayer actions
        createRoom,
        joinRoom,
        leaveRoom,

        // Constants
        CHIP_VALUES
    };
}
