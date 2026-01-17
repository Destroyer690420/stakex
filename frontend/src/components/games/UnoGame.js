import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import useUnoGame from '../../hooks/useUnoGame';
import toast from 'react-hot-toast';
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

    // Get current player name
    const getCurrentPlayerName = () => {
        const player = players.find(p => p.user_id === currentPlayer);
        return player?.username || 'Unknown';
    };

    // Render opponent card backs
    const renderOpponentCards = (opponent, isVertical = false) => {
        const cardCount = opponent?.hand?.length || opponent?.hand_count || 0;
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
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-waiting-room">
                        <h2 className="uno-waiting-title">🎴 Waiting Room</h2>

                        {/* Pot Display */}
                        <div className="uno-pot-display waiting">
                            <div className="pot-label">Prize Pool</div>
                            <div className="pot-amount">${Number(room.pot_amount || 0).toLocaleString()}</div>
                            <div className="pot-hint">Entry: ${Number(room.bet_amount || 0).toLocaleString()}</div>
                        </div>

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
                                        {player.has_paid && <span className="paid-check">💰</span>}
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
                            {/* Ready button for non-host players */}
                            {!isHost && (
                                <button
                                    className={`uno-ready-btn ${myPlayer?.is_ready ? 'unready' : ''}`}
                                    onClick={toggleReady}
                                >
                                    {myPlayer?.is_ready ? 'Cancel' : 'Ready'}
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

                            {isHost && (
                                <button className="uno-delete-btn" onClick={deleteRoom}>
                                    🗑️ Delete Room
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Game over with win overlay
    if (room.status === 'finished' || showWinOverlay) {
        const isWinner = String(room.winner_id) === String(user?.id);

        return (
            <div className="uno-wrapper">
                <div className="uno-container">
                    <div className="uno-game-over-overlay">
                        <motion.div
                            className="uno-game-over"
                            initial={{ opacity: 0, scale: 0.8 }}
                            animate={{ opacity: 1, scale: 1 }}
                        >
                            {isWinner ? (
                                <>
                                    <div className="confetti-wrapper">
                                        {[...Array(50)].map((_, i) => (
                                            <div key={i} className={`confetti confetti-${i % 5}`} style={{
                                                left: `${Math.random() * 100}%`,
                                                animationDelay: `${Math.random() * 2}s`,
                                                animationDuration: `${2 + Math.random() * 2}s`
                                            }} />
                                        ))}
                                    </div>
                                    <h1 className="uno-game-over-title winner">🎉 YOU WON! 🎉</h1>
                                    <div className="win-amount">
                                        <span className="win-label">You won</span>
                                        <span className="win-value">${Number(room.pot_amount || 0).toLocaleString()}</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <h1 className="uno-game-over-title loser">GAME OVER</h1>
                                    <div className="uno-winner-name">👑 {room.winner_username} wins!</div>
                                    <div className="win-amount loser">
                                        <span className="win-label">Prize</span>
                                        <span className="win-value">${Number(room.pot_amount || 0).toLocaleString()}</span>
                                    </div>
                                </>
                            )}
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

                                    return (
                                        <motion.div
                                            key={card.id}
                                            className={`uno-hand-card ${colorClass} ${playable && isMyTurn ? '' : 'not-playable'} ${shakingCard === index ? 'shake' : ''} ${isSpecial ? 'special-card' : ''}`}
                                            style={{ zIndex: index }}
                                            onClick={() => handleCardClick(index)}
                                            initial={{ opacity: 0, y: -100, scale: 0.5 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{
                                                opacity: 0,
                                                y: -300,
                                                scale: 0.4,
                                                rotate: Math.random() * 40 - 20, /* Random rotation on play */
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
