import React, { useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import useUnoGame from '../../hooks/useUnoGame';
import toast from 'react-hot-toast';
import './LandscapeUno.css';

const TURN_DURATION = 15;

/**
 * TURN TIMER COMPONENT
 * 
 * This component uses a `key` prop tied to currentTurnIndex.
 * When the turn changes, the key changes, forcing React to 
 * unmount and remount this component - giving us a fresh timer.
 */
const TurnTimer = ({ isMyTurn, onTimeout }) => {
    const [timeLeft, setTimeLeft] = useState(TURN_DURATION);
    const timerRef = useRef(null);
    const hasTimedOut = useRef(false);

    // Use refs to avoid stale closures while keeping mount-only useEffect
    const isMyTurnRef = useRef(isMyTurn);
    const onTimeoutRef = useRef(onTimeout);

    // Keep refs updated
    useEffect(() => {
        isMyTurnRef.current = isMyTurn;
    }, [isMyTurn]);

    useEffect(() => {
        onTimeoutRef.current = onTimeout;
    }, [onTimeout]);

    useEffect(() => {
        // Reset state on mount
        setTimeLeft(TURN_DURATION);
        hasTimedOut.current = false;

        // Start countdown
        timerRef.current = setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    // Timeout! Only trigger if it's my turn
                    if (isMyTurnRef.current && !hasTimedOut.current) {
                        hasTimedOut.current = true;
                        // Call timeout handler in next tick
                        setTimeout(() => {
                            if (onTimeoutRef.current) onTimeoutRef.current();
                        }, 0);
                    }
                    return TURN_DURATION;
                }
                return prev - 1;
            });
        }, 1000);

        // CLEANUP: Guaranteed timer cleanup when component unmounts
        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, []);

    const timerPercentage = (timeLeft / TURN_DURATION) * 100;

    return (
        <div className="timer-ring-container">
            <svg className="timer-ring" viewBox="0 0 36 36">
                <circle
                    className="timer-ring-bg"
                    cx="18" cy="18" r="16"
                    fill="none" strokeWidth="2"
                />
                <circle
                    className={`timer-ring-progress ${isMyTurn ? 'my-turn' : ''}`}
                    cx="18" cy="18" r="16"
                    fill="none" strokeWidth="2.5"
                    strokeDasharray="100.53"
                    strokeDashoffset={100.53 - (timerPercentage / 100) * 100.53}
                    strokeLinecap="round"
                />
            </svg>
            <span className="timer-text">{timeLeft}</span>
        </div>
    );
};

/**
 * LANDSCAPE UNO GAME COMPONENT
 */
const LandscapeUnoGame = () => {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const { user } = useContext(AuthContext);

    const {
        room,
        players,
        myHand,
        loading,
        error,
        isMyTurn,
        currentTurnIndex,      // For timer key
        currentPlayerName,     // Pre-computed display name
        gameStatus,
        canCallUno,
        isSending,
        leaveRoom,
        playCard,
        drawCard,
        shoutUno,
        isCardPlayable,
    } = useUnoGame(roomId);

    const [showColorPicker, setShowColorPicker] = useState(false);
    const [selectedCardIndex, setSelectedCardIndex] = useState(null);
    const [shakingCard, setShakingCard] = useState(null);
    const [hoveredCard, setHoveredCard] = useState(null);

    const handContainerRef = useRef(null);

    // Memoize opponents
    const opponents = useMemo(() =>
        players.filter(p => String(p.user_id) !== String(user?.id)),
        [players, user?.id]
    );

    // ========================================
    // TIMER TIMEOUT HANDLER
    // ========================================
    const handleTimerTimeout = useCallback(() => {
        // Double-check it's still my turn before auto-drawing
        if (isMyTurn) {
            console.log('[UNO] Timer expired, auto-drawing card');
            drawCard().catch(err => {
                console.error('[UNO] Auto-draw failed:', err);
            });
        }
    }, [isMyTurn, drawCard]);

    // ========================================
    // CARD CLICK HANDLER
    // ========================================
    const handleCardClick = useCallback(async (cardIndex) => {
        if (isSending) return;

        if (!isMyTurn) {
            toast.error("Not your turn!");
            return;
        }

        const card = myHand[cardIndex];

        if (!isCardPlayable(card)) {
            setShakingCard(cardIndex);
            setTimeout(() => setShakingCard(null), 500);
            return;
        }

        if (card.type === 'wild') {
            setSelectedCardIndex(cardIndex);
            setShowColorPicker(true);
            return;
        }

        const result = await playCard(cardIndex);
        if (!result.success) {
            setShakingCard(cardIndex);
            setTimeout(() => setShakingCard(null), 500);
        }
    }, [isMyTurn, isSending, myHand, isCardPlayable, playCard]);

    // ========================================
    // COLOR PICKER
    // ========================================
    const handleColorSelect = async (color) => {
        setShowColorPicker(false);
        if (selectedCardIndex !== null) {
            await playCard(selectedCardIndex, color);
            setSelectedCardIndex(null);
        }
    };

    // ========================================
    // DRAW CARD
    // ========================================
    const handleDrawCard = async () => {
        if (!isMyTurn) {
            toast.error("Not your turn!");
            return;
        }
        await drawCard();
    };

    // ========================================
    // LEAVE ROOM
    // ========================================
    const handleLeave = async () => {
        await leaveRoom();
        navigate('/games/uno');
    };

    // ========================================
    // UTILITIES
    // ========================================
    const getCardDisplay = (value) => {
        if (value === 'skip') return '⊘';
        if (value === 'reverse') return '⇄';
        if (value === '+2') return '+2';
        if (value === '+4') return '+4';
        if (value === 'wild') return '★';
        return value;
    };

    // Check if specific player is active (using seat_index)
    const isPlayerActive = useCallback((player) => {
        return player?.seat_index === currentTurnIndex;
    }, [currentTurnIndex]);

    // Card layout calculation
    const calculateCardLayout = () => {
        const cardCount = myHand.length;
        const baseCardWidth = 85;
        const baseCardHeight = 120;
        const enableScroll = cardCount > 12;

        let overlap = -35;
        if (cardCount > 7 && cardCount <= 12) {
            overlap = -40 - (cardCount - 7) * 3;
        }

        return { cardWidth: baseCardWidth, cardHeight: baseCardHeight, overlap, enableScroll };
    };

    const cardLayout = calculateCardLayout();

    // ========================================
    // RENDER STATES
    // ========================================

    if (loading) {
        return (
            <div className="landscape-uno-wrapper">
                <div className="landscape-uno-loading">
                    <div className="loading-spinner"></div>
                    <div className="loading-text">Loading game...</div>
                </div>
            </div>
        );
    }

    if (error || !room) {
        return (
            <div className="landscape-uno-wrapper">
                <div className="landscape-uno-error">
                    <div className="error-icon">❌</div>
                    <div className="error-text">Room not found</div>
                    <button className="back-btn" onClick={() => navigate('/games/uno')}>
                        Back to Lobby
                    </button>
                </div>
            </div>
        );
    }

    // Game Over
    if (gameStatus === 'finished') {
        const isWinner = String(room.winner_id) === String(user?.id);

        if (isWinner) {
            return (
                <div className="landscape-uno-win-video-wrapper">
                    <video
                        className="win-video"
                        src="/videos/win_video.mp4"
                        autoPlay
                        playsInline
                        muted={false}
                    />
                    <div className="win-overlay">
                        <div className="win-prize">🎉 YOU WON ${Number(room.pot_amount || 0).toLocaleString()}!</div>
                        <button className="back-btn" onClick={() => navigate('/games/uno')}>
                            Back to Lobby
                        </button>
                    </div>
                </div>
            );
        }

        return (
            <div className="landscape-uno-wrapper">
                <div className="landscape-uno-gameover">
                    <h1 className="gameover-title loser">GAME OVER</h1>
                    <div className="winner-name">👑 {room.winner_username} wins!</div>
                    <div className="prize-amount">${Number(room.pot_amount || 0).toLocaleString()}</div>
                    <button className="back-btn" onClick={() => navigate('/games/uno')}>
                        Back to Lobby
                    </button>
                </div>
            </div>
        );
    }

    // ========================================
    // ACTIVE GAME
    // ========================================
    return (
        <div className="landscape-uno-wrapper">
            {/* Quit Button */}
            <button className="landscape-quit-btn" onClick={handleLeave}>✕</button>

            {/* Top Bar with Player Names */}
            <div className="landscape-top-bar">
                <div className="landscape-players-bar">
                    {/* Me - use isMyTurn directly */}
                    <div className={`player-name-item ${isMyTurn ? 'active' : ''}`}>
                        {user?.username || 'You'}
                        <span className="player-card-count">{myHand.length}</span>
                    </div>

                    {/* Opponents - use seat_index comparison */}
                    {opponents.slice(0, 3).map((opponent) => (
                        <div
                            key={opponent.user_id}
                            className={`player-name-item ${isPlayerActive(opponent) ? 'active' : ''}`}
                        >
                            {opponent.username || 'Player'}
                            <span className="player-card-count">{opponent.hand_count || 7}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Central Arena */}
            <div className="landscape-arena">
                <div className="landscape-deck-container">
                    {/* Draw Pile */}
                    <div
                        className={`landscape-draw-pile ${!isMyTurn ? 'disabled' : ''}`}
                        onClick={isMyTurn ? handleDrawCard : undefined}
                    >
                        <div className="draw-pile-stack"></div>
                        <div className="uno-card-back">
                            <div className="uno-logo">UNO</div>
                        </div>
                        {isMyTurn && <div className="draw-hint">Draw</div>}
                    </div>

                    {/* Discard Pile */}
                    <div className="landscape-discard-pile">
                        <AnimatePresence mode="wait">
                            {room.top_card && (
                                <motion.div
                                    key={`${room.top_card.id}-${room.current_color}`}
                                    className={`landscape-card ${room.top_card.type === 'wild' ? room.current_color : room.top_card.color}`}
                                    initial={{ scale: 0.8, rotate: -10 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                >
                                    <span className="card-corner top-left">
                                        {getCardDisplay(room.top_card.value)}
                                    </span>
                                    <span className="card-center">
                                        {getCardDisplay(room.top_card.value)}
                                    </span>
                                    <span className="card-corner bottom-right">
                                        {getCardDisplay(room.top_card.value)}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Color Indicator */}
                <div className={`landscape-color-indicator ${room.current_color}`}></div>
            </div>

            {/* Turn Indicator with Timer 
                KEY PROP: When currentTurnIndex changes, this forces a complete remount
                of the TurnTimer component, guaranteeing a fresh timer state.
            */}
            <div className={`landscape-turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
                <TurnTimer
                    key={`timer-${currentTurnIndex}-${gameStatus}`}
                    isMyTurn={isMyTurn}
                    onTimeout={handleTimerTimeout}
                    currentTurnIndex={currentTurnIndex}
                />
                <span className="turn-player-name">{currentPlayerName}</span>
            </div>

            {/* Player's Hand */}
            <div className="landscape-hand-area">
                <div
                    ref={handContainerRef}
                    className={`landscape-hand ${cardLayout.enableScroll ? 'scrollable' : ''}`}
                >
                    <AnimatePresence>
                        {myHand.map((card, index) => {
                            const playable = isCardPlayable(card);
                            const colorClass = card.type === 'wild' ? 'wild' : card.color;
                            const isHovered = hoveredCard === index;

                            return (
                                <motion.div
                                    key={card.id}
                                    className={`landscape-hand-card ${colorClass} ${playable && isMyTurn ? 'playable' : 'not-playable'} ${shakingCard === index ? 'shake' : ''} ${isHovered ? 'hovered' : ''}`}
                                    style={{
                                        zIndex: isHovered ? 100 : index,
                                        marginLeft: index === 0 ? 0 : `${cardLayout.overlap}px`,
                                        width: `${cardLayout.cardWidth}px`,
                                        height: `${cardLayout.cardHeight}px`,
                                    }}
                                    onClick={() => handleCardClick(index)}
                                    onMouseEnter={() => setHoveredCard(index)}
                                    onMouseLeave={() => setHoveredCard(null)}
                                    initial={{ opacity: 0, y: 100 }}
                                    animate={{
                                        opacity: 1,
                                        y: isHovered ? -16 : 0,
                                    }}
                                    exit={{
                                        opacity: 0,
                                        y: -200,
                                        scale: 0.5,
                                        transition: { duration: 0.3 }
                                    }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                >
                                    <span className="card-corner top-left">
                                        {getCardDisplay(card.value)}
                                    </span>
                                    <span className="card-center">
                                        {getCardDisplay(card.value)}
                                    </span>
                                    <span className="card-corner bottom-right">
                                        {getCardDisplay(card.value)}
                                    </span>
                                </motion.div>
                            );
                        })}
                    </AnimatePresence>
                </div>
            </div>

            {/* UNO Button */}
            {canCallUno && (
                <motion.button
                    className="landscape-uno-btn"
                    onClick={shoutUno}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                >
                    UNO!
                </motion.button>
            )}

            {/* Color Picker */}
            <AnimatePresence>
                {showColorPicker && (
                    <motion.div
                        className="landscape-color-picker-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowColorPicker(false)}
                    >
                        <motion.div
                            className="landscape-color-picker"
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.8 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="color-picker-title">Choose Color</h3>
                            <div className="color-options">
                                {['red', 'blue', 'green', 'yellow'].map(color => (
                                    <motion.button
                                        key={color}
                                        className={`color-option ${color}`}
                                        onClick={() => handleColorSelect(color)}
                                        whileHover={{ scale: 1.1 }}
                                        whileTap={{ scale: 0.9 }}
                                    />
                                ))}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default LandscapeUnoGame;
