import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import useUnoGame from '../../hooks/useUnoGame';
import toast from 'react-hot-toast';
import './Uno.css';

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
        joinRoom,
        leaveRoom,
        toggleReady,
        startGame,
        playCard,
        drawCard,
        shoutUno,
        challengeUno,
        isCardPlayable,
    } = useUnoGame(roomId);

    const [showColorPicker, setShowColorPicker] = useState(false);
    const [selectedCardIndex, setSelectedCardIndex] = useState(null);
    const [shakingCard, setShakingCard] = useState(null);

    // Get my player info
    const myPlayer = players.find(p => p.user_id === user?.id);
    const isHost = room?.host_id === user?.id;
    const opponents = players.filter(p => p.user_id !== user?.id);

    // Position opponents: top, left, right based on count
    const getOpponentPositions = () => {
        if (opponents.length === 1) return { top: opponents[0], left: null, right: null };
        if (opponents.length === 2) return { top: opponents[0], left: null, right: opponents[1] };
        if (opponents.length === 3) return { top: opponents[0], left: opponents[1], right: opponents[2] };
        return { top: null, left: null, right: null };
    };

    const { top: topOpponent, left: leftOpponent, right: rightOpponent } = getOpponentPositions();

    // Check if we need to join the room first
    useEffect(() => {
        if (!loading && room && !myPlayer && room.status === 'waiting') {
            joinRoom();
        }
    }, [loading, room, myPlayer]);

    // Handle card click
    const handleCardClick = useCallback(async (cardIndex) => {
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
    }, [isMyTurn, myHand, isCardPlayable, playCard]);

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

    // Render opponent card backs
    const renderOpponentCards = (opponent, isVertical = false) => {
        const cardCount = opponent?.hand?.length || 0;
        const isActive = room?.player_order?.[room.turn_index] === opponent?.user_id;

        return (
            <div className={`uno-opponent ${isActive ? 'active' : ''}`}>
                <div className={isVertical ? 'uno-opponent-cards-vertical' : 'uno-opponent-cards-horizontal'}>
                    {Array.from({ length: Math.min(cardCount, 7) }).map((_, i) => (
                        <div key={i} className={isVertical ? 'uno-card-back-v' : 'uno-card-back-h'} />
                    ))}
                </div>
                <div className="uno-opponent-label">
                    <span className="score">
                        <span className="star">★</span>
                        <span>0</span>
                    </span>
                    <span className="player-name">{opponent?.username || 'Player'}</span>
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
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-waiting-room">
                        <h2 className="uno-waiting-title">🎴 Waiting Room</h2>

                        <div className="uno-players-list">
                            {players.map((player) => (
                                <div
                                    key={player.id}
                                    className={`uno-player-row ${player.user_id === room.host_id ? 'is-host' : ''}`}
                                >
                                    <div className="uno-player-info">
                                        <div className="uno-player-avatar">
                                            {player.username.charAt(0).toUpperCase()}
                                        </div>
                                        <div>
                                            <span className="uno-player-name">{player.username}</span>
                                            {player.user_id === room.host_id && (
                                                <span className="uno-player-badge">👑 HOST</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`uno-ready-status ${player.is_ready || player.user_id === room.host_id ? 'ready' : 'not-ready'}`}>
                                        {player.user_id === room.host_id ? '✓ Host' : (player.is_ready ? '✓ Ready' : '○ Not Ready')}
                                    </div>
                                </div>
                            ))}

                            {Array.from({ length: room.max_players - players.length }).map((_, i) => (
                                <div key={`empty-${i}`} className="uno-player-row">
                                    <div className="uno-player-info">
                                        <div className="uno-player-avatar" style={{ background: 'rgba(255,255,255,0.1)' }}>?</div>
                                        <span className="uno-player-name" style={{ color: '#555' }}>Waiting...</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="uno-waiting-actions">
                            {!isHost && myPlayer && (
                                <button
                                    className={`uno-ready-btn ${myPlayer.is_ready ? 'unready' : ''}`}
                                    onClick={toggleReady}
                                >
                                    {myPlayer.is_ready ? 'Cancel' : 'Ready'}
                                </button>
                            )}

                            {isHost && (
                                <button
                                    className="uno-start-btn"
                                    onClick={startGame}
                                    disabled={!allPlayersReady || players.length < 2}
                                >
                                    {players.length < 2 ? 'Need 2+ Players' : !allPlayersReady ? 'Waiting...' : 'Start Game'}
                                </button>
                            )}

                            <button className="uno-leave-btn" onClick={handleLeave}>Leave</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Game over
    if (room.status === 'finished') {
        const isWinner = room.winner_id === user?.id;

        return (
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-game-over-overlay">
                        <motion.div
                            className="uno-game-over"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                        >
                            <h1 className={`uno-game-over-title ${isWinner ? 'winner' : 'loser'}`}>
                                {isWinner ? '🎉 YOU WON!' : 'GAME OVER'}
                            </h1>
                            <div className="uno-winner-name">👑 {room.winner_username}</div>
                            <button className="uno-create-btn" onClick={() => navigate('/games/uno')}>
                                Back to Lobby
                            </button>
                        </motion.div>
                    </div>
                </div>
            </div>
        );
    }

    // Active game - 4 player layout
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

                <div className="uno-game-board">
                    {/* Top Opponent (Player 3) */}
                    <div className="uno-opponent-top">
                        {topOpponent && renderOpponentCards(topOpponent, false)}
                    </div>

                    {/* Left Opponent (Player 2) */}
                    <div className="uno-opponent-left">
                        {leftOpponent && renderOpponentCards(leftOpponent, true)}
                    </div>

                    {/* Center Play Area */}
                    <div className="uno-center-area">
                        {/* Navigation & Special Mode */}
                        <button className="uno-nav-arrow">‹</button>

                        <div className="uno-piles-container">
                            {/* Draw Pile */}
                            <div
                                className={`uno-draw-pile ${!isMyTurn ? 'disabled' : ''}`}
                                onClick={isMyTurn ? handleDrawCard : undefined}
                            >
                                <div className="uno-draw-pile-stack"></div>
                                <div className="uno-card-back-large"></div>
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

                        <button className="uno-nav-arrow">›</button>

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
                            <span className="player-name">PLAYER 1</span>
                            <span className="score">
                                <span>0</span>
                                <span className="star">★</span>
                            </span>
                        </div>

                        <div className="uno-hand">
                            <AnimatePresence>
                                {myHand.map((card, index) => {
                                    const playable = isCardPlayable(card);
                                    const colorClass = card.type === 'wild' ? 'wild' : card.color;

                                    return (
                                        <motion.div
                                            key={`${card.id}-${index}`}
                                            className={`uno-hand-card ${colorClass} ${playable && isMyTurn ? '' : 'not-playable'} ${shakingCard === index ? 'shake' : ''}`}
                                            onClick={() => handleCardClick(index)}
                                            initial={{ opacity: 0, y: 50 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -30 }}
                                            transition={{ delay: index * 0.03 }}
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
            </div>
        </div>
    );
};

export default UnoGame;
