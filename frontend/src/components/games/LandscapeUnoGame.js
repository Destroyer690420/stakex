import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import useUnoGame from '../../hooks/useUnoGame';
import toast from 'react-hot-toast';
import './LandscapeUno.css';

const TURN_DURATION = 15;

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
        currentPlayer,
        canCallUno,
        isSending,
        joinRoom,
        leaveRoom,
        playCard,
        drawCard,
        shoutUno,
        isCardPlayable,
    } = useUnoGame(roomId);

    const [showColorPicker, setShowColorPicker] = useState(false);
    const [selectedCardIndex, setSelectedCardIndex] = useState(null);
    const [shakingCard, setShakingCard] = useState(null);
    const [turnTimeLeft, setTurnTimeLeft] = useState(TURN_DURATION);
    const [hoveredCard, setHoveredCard] = useState(null);

    const timerRef = useRef(null);
    const handContainerRef = useRef(null);

    // Get my player info
    const myPlayer = players.find(p => String(p.user_id) === String(user?.id));
    const opponents = players.filter(p => String(p.user_id) !== String(user?.id));

    // Turn timer
    useEffect(() => {
        if (room?.status !== 'playing') return;

        setTurnTimeLeft(TURN_DURATION);
        let hasAutoDrawn = false;

        timerRef.current = setInterval(() => {
            setTurnTimeLeft(prev => {
                if (prev <= 1) {
                    if (isMyTurn && !hasAutoDrawn) {
                        hasAutoDrawn = true;
                        if (timerRef.current) {
                            clearInterval(timerRef.current);
                        }
                        drawCard().catch(err => console.error('Auto-draw failed:', err));
                    }
                    return TURN_DURATION;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
            }
        };
    }, [room?.current_turn_index, room?.status, isMyTurn, drawCard]);

    // Handle card click
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

    const handleColorSelect = async (color) => {
        setShowColorPicker(false);
        if (selectedCardIndex !== null) {
            await playCard(selectedCardIndex, color);
            setSelectedCardIndex(null);
        }
    };

    const handleDrawCard = async () => {
        if (!isMyTurn) {
            toast.error("Not your turn!");
            return;
        }
        await drawCard();
    };

    const handleLeave = async () => {
        await leaveRoom();
        navigate('/games/uno');
    };

    // Get card display value
    const getCardDisplay = (value) => {
        if (value === 'skip') return '⊘';
        if (value === 'reverse') return '⇄';
        if (value === '+2') return '+2';
        if (value === '+4') return '+4';
        if (value === 'wild') return '★';
        return value;
    };

    // Get player by user_id
    const getPlayerByUserId = (userId) => {
        return players.find(p => p.user_id === userId);
    };

    // Check if player is active (their turn)
    const isPlayerActive = (player) => {
        return room?.player_order?.[room.current_turn_index] === player?.user_id;
    };

    // Get current player's name
    const getCurrentPlayerName = () => {
        const currentPlayerId = room?.player_order?.[room.current_turn_index];
        if (currentPlayerId === user?.id) {
            return 'Your Turn';
        }
        const player = players.find(p => p.user_id === currentPlayerId);
        return player?.username || 'Player';
    };

    // Calculate timer percentage for circular progress
    const timerPercentage = (turnTimeLeft / TURN_DURATION) * 100;

    // Loading state
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

    // Error state
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

    // Game over
    if (room.status === 'finished') {
        const isWinner = String(room.winner_id) === String(user?.id);
        return (
            <div className="landscape-uno-wrapper">
                <div className="landscape-uno-gameover">
                    <h1 className={`gameover-title ${isWinner ? 'winner' : 'loser'}`}>
                        {isWinner ? '🎉 YOU WON!' : 'GAME OVER'}
                    </h1>
                    {!isWinner && (
                        <div className="winner-name">👑 {room.winner_username} wins!</div>
                    )}
                    <div className="prize-amount">${Number(room.pot_amount || 0).toLocaleString()}</div>
                    <button className="back-btn" onClick={() => navigate('/games/uno')}>
                        Back to Lobby
                    </button>
                </div>
            </div>
        );
    }

    // Calculate card overlap based on hand size
    const calculateCardLayout = () => {
        const cardCount = myHand.length;
        const baseCardWidth = 85;
        const baseCardHeight = 120;

        // For 12+ cards, enable horizontal scroll
        const enableScroll = cardCount > 12;

        // Calculate overlap - more cards = more overlap (up to a limit)
        let overlap = -35;
        if (cardCount > 7 && cardCount <= 12) {
            overlap = -40 - (cardCount - 7) * 3;
        }

        return {
            cardWidth: baseCardWidth,
            cardHeight: baseCardHeight,
            overlap,
            enableScroll
        };
    };

    const cardLayout = calculateCardLayout();

    return (
        <div className="landscape-uno-wrapper">
            {/* Quit Button - Top Right */}
            <button className="landscape-quit-btn" onClick={handleLeave}>
                ✕
            </button>

            {/* Top Navigation Bar */}
            <div className="landscape-top-bar">
                {/* Player Names */}
                <div className="landscape-players-bar">
                    {/* Current Player (Me) - always first */}
                    <div className={`player-name-item ${isMyTurn ? 'active' : ''}`}>
                        {user?.username || 'You'}
                    </div>

                    {/* Opponents */}
                    {opponents.slice(0, 3).map((opponent, index) => (
                        <div
                            key={opponent.user_id}
                            className={`player-name-item ${isPlayerActive(opponent) ? 'active' : ''}`}
                        >
                            {opponent.username || `Player ${index + 2}`}
                        </div>
                    ))}
                </div>
            </div>

            {/* Central Game Arena */}
            <div className="landscape-arena">
                {/* Deck Container */}
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

                {/* Current Color Indicator */}
                <div className={`landscape-color-indicator ${room.current_color}`}></div>
            </div>

            {/* Turn Indicator with Circular Timer - Top Left */}
            <div className={`landscape-turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
                <div className="timer-ring-container">
                    <svg className="timer-ring" viewBox="0 0 36 36">
                        <circle
                            className="timer-ring-bg"
                            cx="18"
                            cy="18"
                            r="16"
                            fill="none"
                            strokeWidth="2"
                        />
                        <circle
                            className={`timer-ring-progress ${isMyTurn ? 'my-turn' : ''}`}
                            cx="18"
                            cy="18"
                            r="16"
                            fill="none"
                            strokeWidth="2.5"
                            strokeDasharray="100.53"
                            strokeDashoffset={100.53 - (timerPercentage / 100) * 100.53}
                            strokeLinecap="round"
                        />
                    </svg>
                    <span className="timer-text">{turnTimeLeft}</span>
                </div>
                <span className="turn-player-name">{getCurrentPlayerName()}</span>
            </div>

            {/* Player's Hand (Bottom) */}
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

            {/* Color Picker Modal */}
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

