import React, { useState, useContext, useCallback, useRef, useMemo } from 'react';
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
        opponents,
        myHand,
        loading,
        error,
        isMyTurn,
        currentTurnIndex,
        currentPlayerName,
        turnTimeLeft,
        topCard,
        currentColor,
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

    // ========================================
    // HANDLERS
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

    const isPlayerActive = useCallback((player) => {
        return player?.seat_index === currentTurnIndex;
    }, [currentTurnIndex]);

    const timerPercentage = (turnTimeLeft / TURN_DURATION) * 100;

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
        const isWinner = room.winner_id === user?.id;

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
                    {/* Me */}
                    <div className={`player-name-item ${isMyTurn ? 'active' : ''}`}>
                        {user?.username || 'You'}
                        <span className="player-card-count">{myHand.length}</span>
                    </div>

                    {/* Opponents */}
                    {opponents.slice(0, 3).map((opponent) => (
                        <div
                            key={opponent.user_id}
                            className={`player-name-item ${isPlayerActive(opponent) ? 'active' : ''}`}
                        >
                            {opponent.username || 'Player'}
                            <span className="player-card-count">{opponent.hand?.length || 7}</span>
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
                            {topCard && (
                                <motion.div
                                    key={`${topCard.id}-${currentColor}`}
                                    className={`landscape-card ${topCard.type === 'wild' ? currentColor : topCard.color}`}
                                    initial={{ scale: 0.8, rotate: -10 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                >
                                    <span className="card-corner top-left">
                                        {getCardDisplay(topCard.value)}
                                    </span>
                                    <span className="card-center">
                                        {getCardDisplay(topCard.value)}
                                    </span>
                                    <span className="card-corner bottom-right">
                                        {getCardDisplay(topCard.value)}
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>

                {/* Color Indicator */}
                <div className={`landscape-color-indicator ${currentColor}`}></div>
            </div>

            {/* Turn Indicator with Timer */}
            <div className={`landscape-turn-indicator ${isMyTurn ? 'my-turn' : ''}`}>
                <div className="timer-ring-container">
                    <svg className="timer-ring" viewBox="0 0 36 36">
                        <circle className="timer-ring-bg" cx="18" cy="18" r="16" fill="none" strokeWidth="2" />
                        <circle
                            className={`timer-ring-progress ${isMyTurn ? 'my-turn' : ''}`}
                            cx="18" cy="18" r="16"
                            fill="none" strokeWidth="2.5"
                            strokeDasharray="100.53"
                            strokeDashoffset={100.53 - (timerPercentage / 100) * 100.53}
                            strokeLinecap="round"
                        />
                    </svg>
                    <span className="timer-text">{turnTimeLeft}</span>
                </div>
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
