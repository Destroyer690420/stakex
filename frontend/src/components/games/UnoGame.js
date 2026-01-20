import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import useUnoGame from '../../hooks/useUnoGame';
import toast from 'react-hot-toast';
import LandscapeUnoGame from './LandscapeUnoGame';
import UnoWaitingRoom from './UnoWaitingRoom';
import './Uno.css';

const TURN_DURATION = 15; // 15 seconds per turn

const UnoGame = () => {
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
        deleteRoom,
        toggleReady,
        startGame,
        playCard,
        drawCard,
        shoutUno,
        isCardPlayable,
    } = useUnoGame(roomId);

    const [showColorPicker, setShowColorPicker] = useState(false);
    const [selectedCardIndex, setSelectedCardIndex] = useState(null);
    const [shakingCard, setShakingCard] = useState(null);
    const [turnTimeLeft, setTurnTimeLeft] = useState(TURN_DURATION);
    const [showWinOverlay, setShowWinOverlay] = useState(false);

    const timerRef = useRef(null);
    const [screenWidth, setScreenWidth] = useState(window.innerWidth);
    const [screenHeight, setScreenHeight] = useState(window.innerHeight);

    useEffect(() => {
        const handleResize = () => {
            setScreenWidth(window.innerWidth);
            setScreenHeight(window.innerHeight);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Detect landscape mode
    const isLandscape = screenWidth > screenHeight;

    // Get my player info - use string comparison for UUIDs
    const myPlayer = players.find(p => String(p.user_id) === String(user?.id));
    const isHost = String(room?.host_id) === String(user?.id);
    const opponents = players.filter(p => String(p.user_id) !== String(user?.id));

    // Position opponents: top, left, right based on count
    const getOpponentPositions = () => {
        if (opponents.length === 1) return { top: opponents[0], left: null, right: null };
        if (opponents.length === 2) return { top: opponents[0], left: null, right: opponents[1] };
        if (opponents.length === 3) return { top: opponents[0], left: opponents[1], right: opponents[2] };
        return { top: null, left: null, right: null };
    };

    const { top: topOpponent, left: leftOpponent, right: rightOpponent } = getOpponentPositions();

    // Turn timer
    useEffect(() => {
        if (room?.status !== 'playing') return;

        // Reset timer when turn changes
        setTurnTimeLeft(TURN_DURATION);
        let hasAutoDrawn = false;

        timerRef.current = setInterval(() => {
            setTurnTimeLeft(prev => {
                if (prev <= 1) {
                    // Time's up - auto draw if it's my turn and haven't already drawn
                    if (isMyTurn && !hasAutoDrawn) {
                        hasAutoDrawn = true;
                        // Clear interval first to prevent multiple calls
                        if (timerRef.current) {
                            clearInterval(timerRef.current);
                        }
                        // Auto draw card
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

    // Check for game end
    useEffect(() => {
        if (room?.status === 'finished' && room?.winner_id) {
            setShowWinOverlay(true);
        }
    }, [room?.status, room?.winner_id]);

    // Check if we need to join the room first
    useEffect(() => {
        if (!loading && room && !myPlayer && room.status === 'waiting') {
            joinRoom();
        }
    }, [loading, room, myPlayer, joinRoom]);

    // Handle card click
    const handleCardClick = useCallback(async (cardIndex) => {
        if (isSending) return; // Prevent double-clicks during optimistic update

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

    const allPlayersReady = players.length >= 2 &&
        players.every(p => p.is_ready || p.user_id === room?.host_id);

    // Render card value display
    const getCardDisplay = (value) => {
        if (value === 'skip') return '⊘';
        if (value === 'reverse') return '⇄';
        if (value === '+2') return '+2';
        if (value === '+4') return '+4';
        if (value === 'wild') return '★';
        return value;
    };

    // Get current player name
    const getCurrentPlayerName = () => {
        const player = players.find(p => p.user_id === currentPlayer);
        return player?.username || 'Unknown';
    };

    // Render opponent card backs
    const renderOpponentCards = (opponent, isVertical = false) => {
        // In split state, opponent hands are in hidden_states, not uno_players
        // We track card count via hand_count field or fallback to 7 (initial deal)
        const cardCount = opponent?.hand_count || 7;
        const isActive = room?.player_order?.[room.current_turn_index] === opponent?.user_id;

        return (
            <div className={`uno-opponent ${isActive ? 'active' : ''}`}>
                <div className={isVertical ? 'uno-opponent-cards-vertical' : 'uno-opponent-cards-horizontal'}>
                    {Array.from({ length: Math.min(cardCount, 7) }).map((_, i) => (
                        <div key={i} className={isVertical ? 'uno-card-back-v' : 'uno-card-back-h'} />
                    ))}
                </div>
                <div className="uno-opponent-label">
                    <span className="score">
                        <span className="card-count">{cardCount}</span>
                        <span className="cards-icon">🃏</span>
                    </span>
                    <span className="player-name">{opponent?.username || 'Player'}</span>
                    {opponent?.has_paid && <span className="paid-badge">✓</span>}
                </div>
            </div>
        );
    };

    // Loading state
    if (loading) {
        return (
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-loading">
                        <div className="uno-loading-spinner"></div>
                        <div className="uno-loading-text">Loading game...</div>
                    </div>
                </div>
            </div>
        );
    }

    // Error state
    if (error || !room) {
        return (
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-empty-state">
                        <div className="uno-empty-icon">❌</div>
                        <div className="uno-empty-text">Room not found</div>
                        <button className="uno-create-btn" onClick={() => navigate('/games/uno')}>
                            Back to Lobby
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Waiting room
    if (room.status === 'waiting') {
        return (
            <UnoWaitingRoom
                room={room}
                players={players}
                onStart={startGame}
                onLeave={handleLeave}
                onDelete={deleteRoom}
                onToggleReady={toggleReady}
                isHost={isHost}
                myPlayer={myPlayer}
            />
        );
    }

    // Game over with win overlay
    if (room.status === 'finished' || showWinOverlay) {
        const isWinner = String(room.winner_id) === String(user?.id);

        // Winner sees fullscreen video
        if (isWinner) {
            return (
                <div className="uno-wrapper">
                    <div className="uno-container">
                        <div className="uno-winner-video-overlay">
                            <video
                                className="uno-winner-video"
                                src="/winner_video.mp4"
                                autoPlay
                                playsInline
                                onEnded={() => navigate('/games/uno')}
                            />
                            <button
                                className="uno-skip-video-btn"
                                onClick={() => navigate('/games/uno')}
                            >
                                Skip →
                            </button>
                            <div className="uno-winner-prize-overlay">
                                <div className="prize-text">🎉 YOU WON!</div>
                                <div className="prize-amount">${Number(room.pot_amount || 0).toLocaleString()}</div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        // Losers see normal game over screen
        return (
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-game-over-overlay">
                        <motion.div
                            className="uno-game-over"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                        >
                            <h1 className="uno-game-over-title loser">GAME OVER</h1>
                            <div className="uno-winner-name">👑 {room.winner_username} wins!</div>
                            <div className="win-amount loser">
                                <span className="win-label">Prize</span>
                                <span className="win-value">${Number(room.pot_amount || 0).toLocaleString()}</span>
                            </div>
                            <button className="uno-create-btn" onClick={() => navigate('/games/uno')}>
                                Back to Lobby
                            </button>
                        </motion.div>
                    </div>
                </div>
            </div>
        );
    }

    // Landscape mode - render optimized landscape UI
    if (isLandscape) {
        return <LandscapeUnoGame />;
    }

    // Active game - 4 player layout (portrait)
    return (
        <div className="uno-wrapper">
            <div className="uno-container">
                {/* Rotate Device Overlay for Portrait Mode */}
                <div className="uno-rotate-device">
                    <div className="rotate-icon">📱</div>
                    <div className="rotate-text">Rotate Your Device</div>
                    <div className="rotate-subtext">UNO plays best in landscape mode</div>
                </div>

                {/* Quit Button */}
                <button className="uno-quit-btn" onClick={handleLeave}>
                    🚪 QUIT
                </button>

                {/* Turn Timer */}
                <div className={`uno-turn-timer ${isMyTurn ? 'my-turn' : ''}`}>
                    <div className="timer-bar">
                        <div
                            className="timer-fill"
                            style={{ width: `${(turnTimeLeft / TURN_DURATION) * 100}%` }}
                        />
                    </div>
                    <div className="timer-text">
                        {isMyTurn ? `Your turn: ${turnTimeLeft}s` : `${getCurrentPlayerName()}'s turn`}
                    </div>
                </div>

                <div className="uno-game-board">
                    {/* Top Opponent (Player 3) */}
                    <div className="uno-opponent-top">
                        {topOpponent && renderOpponentCards(topOpponent, false)}
                    </div>

                    {/* Left Opponent (Player 2) */}
                    <div className="uno-opponent-left">
                        {leftOpponent && renderOpponentCards(leftOpponent, true)}
                    </div>

                    <div className="uno-center-area">
                        {/* Pot Display - Now inside center area */}
                        <div className="uno-pot-display game">
                            <div className="pot-icon">💰</div>
                            <div className="pot-value">${Number(room.pot_amount || 0).toLocaleString()}</div>
                        </div>

                        {/* Navigation & Special Mode */}


                        <div className="uno-piles-container">
                            {/* Draw Pile */}
                            <div
                                className={`uno-draw-pile ${!isMyTurn ? 'disabled' : ''}`}
                                onClick={isMyTurn ? handleDrawCard : undefined}
                            >
                                <div className="uno-draw-pile-stack"></div>
                                <div className="uno-card-back-large"></div>
                                {isMyTurn && <div className="draw-hint">Click to draw</div>}
                            </div>

                            {/* Discard Pile */}
                            <div className="uno-discard-pile">
                                <AnimatePresence mode="wait">
                                    {room.top_card && (
                                        <motion.div
                                            key={`${room.top_card.id}-${room.current_color}`}
                                            className={`uno-card ${room.top_card.type === 'wild' ? 'wild' : room.top_card.color}`}
                                            initial={{ scale: 0.8, rotate: -10 }}
                                            animate={{ scale: 1, rotate: 0 }}
                                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                        >
                                            <span className="uno-card-corner top-left">
                                                {getCardDisplay(room.top_card.value)}
                                            </span>
                                            <span className="uno-card-value">
                                                {getCardDisplay(room.top_card.value)}
                                            </span>
                                            <span className="uno-card-corner bottom-right">
                                                {getCardDisplay(room.top_card.value)}
                                            </span>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>



                        {/* Current Color Indicator */}
                        <div className={`uno-color-indicator ${room.current_color}`}></div>
                    </div>

                    {/* Right Opponent (Player 4) */}
                    <div className="uno-opponent-right">
                        {rightOpponent && renderOpponentCards(rightOpponent, true)}
                    </div>

                    {/* Player 1 (Me) - Bottom */}
                    <div className="uno-player-area">
                        <div className="uno-player-label">
                            <span className="player-name">{user?.username || 'YOU'}</span>
                            <span className="score">
                                <span>{myHand.length}</span>
                                <span className="cards-icon">🃏</span>
                            </span>
                        </div>

                        <div className="uno-hand">
                            <AnimatePresence>
                                {myHand.map((card, index) => {
                                    const playable = isCardPlayable(card);
                                    const colorClass = card.type === 'wild' ? 'wild' : card.color;
                                    const isSpecial = ['skip', 'reverse', '+2', '+4'].includes(card.value);

                                    const cardCount = myHand.length;
                                    const baseScale = cardCount > 15 ? 0.85 : cardCount > 10 ? 0.9 : 1;
                                    const cardWidth = 95 * baseScale;

                                    // Dynamic overlap calculation
                                    // Dynamic overlap calculation
                                    // Use 90% of screen width or max 800px for hand container
                                    const availableWidth = Math.min(screenWidth * 0.95, 800);

                                    // Default margin (standard overlap)
                                    let overlap = -30;

                                    // If total width exceeds available width, compress
                                    // Total width = cardWidth + (count-1) * (cardWidth + margin)
                                    // We want Total width <= availableWidth
                                    // margin <= (availableWidth - cardWidth) / (count - 1) - cardWidth

                                    if (cardCount > 1) {
                                        const maxTotalWidth = cardWidth + (cardCount - 1) * (cardWidth + overlap);
                                        if (maxTotalWidth > availableWidth) {
                                            const newMargin = (availableWidth - cardWidth) / (cardCount - 1) - cardWidth;
                                            // Cap the overlap to avoid extreme squeezing if possible, but prioritize fitting
                                            overlap = Math.min(overlap, newMargin);
                                        }
                                    }

                                    let marginLeft = index === 0 ? 0 : overlap;

                                    // Hover effect needs to be handled carefully with heavy overlap
                                    // We'll rely on z-index which is already set by index

                                    return (
                                        <motion.div
                                            key={card.id}
                                            className={`uno-hand-card ${colorClass} ${playable && isMyTurn ? '' : 'not-playable'} ${shakingCard === index ? 'shake' : ''} ${isSpecial ? 'special-card' : ''}`}
                                            style={{
                                                zIndex: index,
                                                marginLeft: `${marginLeft}px`,
                                                width: `${cardWidth}px`,
                                                height: `${135 * baseScale}px`,
                                                transformOrigin: 'bottom center',
                                                // We don't use scale here to avoid messing up the layout calculation
                                                // The baseScale is applied to width/height directly
                                            }}
                                            onClick={() => handleCardClick(index)}
                                            initial={{ opacity: 0, y: 100 }}
                                            animate={{
                                                opacity: 1,
                                                y: 0,
                                                scale: 1, // Reset scale as we apply it to dimensions
                                            }}
                                            whileHover={{
                                                y: -30,
                                                zIndex: 100,
                                                scale: 1.1,
                                                transition: { duration: 0.2 }
                                            }}
                                            exit={{
                                                opacity: 0,
                                                y: -300,
                                                scale: 0.4,
                                                rotate: Math.random() * 40 - 20,
                                                transition: { duration: 0.4 }
                                            }}
                                            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                            layout
                                        >
                                            <span className="card-corner top-left">
                                                {getCardDisplay(card.value)}
                                            </span>
                                            <span className="card-value">
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
                </div>
            </div>

            {/* UNO Button */}
            {canCallUno && (
                <motion.button
                    className="uno-shout-btn"
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
                        className="uno-color-picker-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowColorPicker(false)}
                    >
                        <motion.div
                            className="uno-color-picker"
                            initial={{ scale: 0.8 }}
                            animate={{ scale: 1 }}
                            exit={{ scale: 0.8 }}
                            onClick={e => e.stopPropagation()}
                        >
                            <h3 className="uno-color-picker-title">Choose Color</h3>
                            <div className="uno-color-options">
                                {['red', 'blue', 'green', 'yellow'].map(color => (
                                    <motion.button
                                        key={color}
                                        className={`uno-color-option ${color}`}
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

            {/* Rotate Device Overlay */}
            <div className="uno-rotate-device">
                <div className="rotate-content">
                    <span className="rotate-icon">⟳</span>
                    <p>Please rotate your device to play</p>
                </div>
            </div>
        </div>

    );
};

export default UnoGame;
