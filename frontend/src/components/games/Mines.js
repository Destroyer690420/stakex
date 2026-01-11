import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import './Mines.css';

// Constants
const GRID_SIZE = 25;
const MIN_BET = 10;

const Mines = () => {
    const { user, refreshUser } = useContext(AuthContext);

    // Game state
    const [gameId, setGameId] = useState(null);
    const [gameStatus, setGameStatus] = useState('idle'); // idle, active, won, lost
    const [betAmount, setBetAmount] = useState(100);
    const [minesCount, setMinesCount] = useState(3);

    // Grid state
    const [grid, setGrid] = useState(Array(GRID_SIZE).fill({ revealed: false, isMine: false, isGem: false }));
    const [minePositions, setMinePositions] = useState([]);

    // Multiplier state
    const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
    const [nextMultiplier, setNextMultiplier] = useState(1.08);
    const [revealedCount, setRevealedCount] = useState(0);

    // UI state
    const [isLoading, setIsLoading] = useState(false);
    const [isRevealing, setIsRevealing] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);

    // Calculate values
    const gemsCount = 25 - minesCount;
    const totalProfit = revealedCount > 0 ? (betAmount * currentMultiplier) - betAmount : 0;
    const progressPercent = (revealedCount / gemsCount) * 100;
    const isValidBet = betAmount >= MIN_BET && betAmount <= (user?.cash || 0);

    // Check for active game on mount
    useEffect(() => {
        checkActiveGame();
    }, []);

    // Confetti timeout
    useEffect(() => {
        if (showConfetti) {
            const timer = setTimeout(() => setShowConfetti(false), 3000);
            return () => clearTimeout(timer);
        }
    }, [showConfetti]);

    const checkActiveGame = async () => {
        try {
            const res = await api.get('/games/mines/active');
            if (res.data.success && res.data.hasActiveGame) {
                setGameId(res.data.gameId);
                setGameStatus('active');
                setBetAmount(res.data.betAmount);
                setMinesCount(res.data.minesCount);
                setCurrentMultiplier(res.data.currentMultiplier);
                setNextMultiplier(res.data.nextMultiplier);

                const newGrid = Array(GRID_SIZE).fill(null).map(() => ({ revealed: false, isMine: false, isGem: false }));
                res.data.revealedTiles.forEach(index => {
                    newGrid[index] = { revealed: true, isMine: false, isGem: true };
                });
                setGrid(newGrid);
                setRevealedCount(res.data.revealedTiles.length);
            }
        } catch (err) {
            console.error('Failed to check active game:', err);
        }
    };

    const startGame = async () => {
        if (!isValidBet) return;
        setIsLoading(true);

        try {
            const res = await api.post('/games/mines/start', { betAmount, minesCount });
            if (res.data.success) {
                setGameId(res.data.gameId);
                setGameStatus('active');
                setCurrentMultiplier(res.data.currentMultiplier);
                setNextMultiplier(res.data.nextMultiplier);
                setRevealedCount(0);
                setGrid(Array(GRID_SIZE).fill(null).map(() => ({ revealed: false, isMine: false, isGem: false })));
                setMinePositions([]);
                refreshUser();
            }
        } catch (err) {
            console.error('Start game error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const revealTile = async (index) => {
        if (gameStatus !== 'active' || isRevealing || grid[index].revealed) return;
        setIsRevealing(true);

        try {
            const res = await api.post('/games/mines/reveal', { gameId, tileIndex: index });
            if (res.data.success) {
                const newGrid = [...grid];

                if (res.data.result === 'mine') {
                    newGrid[index] = { revealed: true, isMine: true, isGem: false };
                    res.data.minePositions.forEach(pos => {
                        newGrid[pos] = { ...newGrid[pos], revealed: true, isMine: true };
                    });
                    setGrid(newGrid);
                    setMinePositions(res.data.minePositions);
                    setGameStatus('lost');
                    refreshUser();
                } else if (res.data.result === 'safe') {
                    newGrid[index] = { revealed: true, isMine: false, isGem: true };
                    setGrid(newGrid);
                    setCurrentMultiplier(res.data.currentMultiplier);
                    setNextMultiplier(res.data.nextMultiplier);
                    setRevealedCount(res.data.revealedCount);
                } else if (res.data.result === 'cashout') {
                    newGrid[index] = { revealed: true, isMine: false, isGem: true };
                    res.data.minePositions.forEach(pos => {
                        newGrid[pos] = { ...newGrid[pos], revealed: true, isMine: true };
                    });
                    setGrid(newGrid);
                    setGameStatus('won');
                    setCurrentMultiplier(res.data.multiplier);
                    setShowConfetti(true);
                    refreshUser();
                }
            }
        } catch (err) {
            console.error('Reveal error:', err);
        } finally {
            setIsRevealing(false);
        }
    };

    const cashOut = async () => {
        if (gameStatus !== 'active' || revealedCount === 0) return;
        setIsLoading(true);

        try {
            const res = await api.post('/games/mines/cashout', { gameId });
            if (res.data.success) {
                const newGrid = [...grid];
                res.data.minePositions.forEach(pos => {
                    newGrid[pos] = { ...newGrid[pos], revealed: true, isMine: true };
                });
                setGrid(newGrid);
                setGameStatus('won');
                setCurrentMultiplier(res.data.multiplier);
                setShowConfetti(true);
                refreshUser();
            }
        } catch (err) {
            console.error('Cashout error:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const randomPick = () => {
        if (gameStatus !== 'active') return;
        const unrevealed = grid.map((t, i) => !t.revealed ? i : -1).filter(i => i !== -1);
        if (unrevealed.length > 0) {
            revealTile(unrevealed[Math.floor(Math.random() * unrevealed.length)]);
        }
    };

    const resetGame = () => {
        setGameId(null);
        setGameStatus('idle');
        setGrid(Array(GRID_SIZE).fill(null).map(() => ({ revealed: false, isMine: false, isGem: false })));
        setMinePositions([]);
        setCurrentMultiplier(1.0);
        setRevealedCount(0);
    };

    const renderTile = (index) => {
        const tile = grid[index];
        let tileClass = 'mines-tile';
        let content = '';

        if (tile.revealed) {
            tileClass += tile.isMine ? ' mine' : ' gem';
            content = tile.isMine ? '💣' : '💎';
        } else if (gameStatus === 'active') {
            tileClass += ' clickable';
        }

        return (
            <button
                key={index}
                className={tileClass}
                onClick={() => revealTile(index)}
                disabled={gameStatus !== 'active' || tile.revealed || isRevealing}
                title={gameStatus === 'active' && !tile.revealed ? 'Click to reveal' : ''}
            >
                <span className="tile-content">{content}</span>
                <div className="tile-glow"></div>
            </button>
        );
    };

    return (
        <div className="mines-wrapper">
            {/* Confetti Effect */}
            {showConfetti && <div className="confetti-container">
                {[...Array(50)].map((_, i) => (
                    <div key={i} className="confetti" style={{
                        left: `${Math.random() * 100}%`,
                        animationDelay: `${Math.random() * 2}s`,
                        backgroundColor: ['#FFD700', '#00FF88', '#FF6B6B', '#4ECDC4'][Math.floor(Math.random() * 4)]
                    }}></div>
                ))}
            </div>}

            <div className="mines-container">
                {/* Sidebar Panel */}
                <div className="mines-panel">

                    {gameStatus === 'idle' ? (
                        <>
                            {/* Bet Amount */}
                            <div className="input-group">
                                <div className="input-label">
                                    <span>Bet Amount</span>
                                    <span className="balance-tag">${user?.cash?.toFixed(2) || '0.00'}</span>
                                </div>
                                <div className={`input-field ${!isValidBet ? 'error' : ''}`}>
                                    <span className="cash-icon">🪙</span>
                                    <input
                                        type="number"
                                        value={betAmount}
                                        onChange={(e) => setBetAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                                        min={MIN_BET}
                                    />
                                </div>
                                {!isValidBet && <span className="error-text">Min ${MIN_BET}, Max ${user?.cash?.toFixed(2) || 0}</span>}
                            </div>

                            {/* Mines Input */}
                            <div className="input-group">
                                <div className="input-label">
                                    <span>Mines</span>
                                    <span className="mines-range">1-24</span>
                                </div>
                                <div className="input-field mines-field">
                                    <span className="mines-icon">💣</span>
                                    <input
                                        type="number"
                                        value={minesCount}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 1;
                                            setMinesCount(Math.max(1, Math.min(24, val)));
                                        }}
                                        min={1}
                                        max={24}
                                    />
                                </div>
                            </div>

                            {/* Gems Display */}
                            <div className="input-group">
                                <div className="input-label"><span>Gems</span></div>
                                <div className="gems-display">
                                    <span className="gems-icon">💎</span>
                                    <span className="gems-count">{gemsCount}</span>
                                </div>
                            </div>

                            {/* Bet Button */}
                            <button className="bet-button" onClick={startGame} disabled={isLoading || !isValidBet}>
                                <span className="btn-glow"></span>
                                {isLoading ? <span className="spinner"></span> : 'Bet'}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Game Active State */}
                            <div className="game-stats">
                                <div className="stat-row">
                                    <span>Bet</span>
                                    <span className="stat-value">${betAmount.toFixed(2)}</span>
                                </div>
                                <div className="stat-row">
                                    <span>Mines</span>
                                    <span className="stat-value danger">{minesCount}</span>
                                </div>
                                <div className="stat-row">
                                    <span>Revealed</span>
                                    <span className="stat-value success">{revealedCount}/{gemsCount}</span>
                                </div>
                            </div>

                            {/* Multiplier Display */}
                            <div className="multiplier-box">
                                <div className="mult-current">
                                    <span className="mult-label">Current</span>
                                    <span className="mult-value">{currentMultiplier.toFixed(2)}×</span>
                                </div>
                                {gameStatus === 'active' && (
                                    <div className="mult-next">
                                        <span className="mult-label">Next</span>
                                        <span className="mult-value">{nextMultiplier.toFixed(2)}×</span>
                                    </div>
                                )}
                            </div>

                            {/* Action Button */}
                            {gameStatus === 'active' ? (
                                <>
                                    <button
                                        className={`cashout-button ${revealedCount > 0 ? 'ready' : ''}`}
                                        onClick={cashOut}
                                        disabled={isLoading || revealedCount === 0}
                                    >
                                        <span className="btn-glow"></span>
                                        {revealedCount === 0 ? 'Pick a tile' : `Cashout $${(betAmount * currentMultiplier).toFixed(2)}`}
                                    </button>
                                    <button className="random-button" onClick={randomPick} disabled={isRevealing}>
                                        🎲 Random Pick
                                    </button>
                                </>
                            ) : (
                                <button className={`result-button ${gameStatus}`} onClick={resetGame}>
                                    {gameStatus === 'won' ? '🎉 Play Again' : '💀 Try Again'}
                                </button>
                            )}
                        </>
                    )}

                    {/* Total Profit */}
                    <div className="profit-section">
                        <div className="profit-header">
                            <span>Total Profit</span>
                            <span className="profit-mult">({currentMultiplier.toFixed(2)}×)</span>
                        </div>
                        <div className={`profit-display ${totalProfit > 0 ? 'positive' : ''}`}>
                            <span className="cash-icon">🪙</span>
                            <span className="profit-amount">{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                {/* Grid Area */}
                <div className="mines-grid-area">
                    {/* Progress Bar */}
                    {gameStatus !== 'idle' && (
                        <div className="progress-container">
                            <div className="progress-bar" style={{ width: `${progressPercent}%` }}></div>
                            <span className="progress-text">{revealedCount} / {gemsCount} Gems</span>
                        </div>
                    )}

                    {/* Grid */}
                    <div className="mines-grid">
                        {Array(GRID_SIZE).fill(null).map((_, i) => renderTile(i))}
                    </div>

                    {/* Result Banner */}
                    {(gameStatus === 'won' || gameStatus === 'lost') && (
                        <div className={`result-banner ${gameStatus}`}>
                            {gameStatus === 'won' ? (
                                <>🎉 You Won <span className="win-amount">${(betAmount * currentMultiplier).toFixed(2)}</span>!</>
                            ) : (
                                <>💥 Boom! You hit a mine!</>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Mines;
