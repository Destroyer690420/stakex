import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import './Tower.css';

// Constants
const GRID_ROWS = 10;
const GRID_COLS = 5;
const MIN_BET = 10;

// Calculate multipliers based on difficulty
// Must match the SQL function: ROUND((base ^ (row + 1))::NUMERIC, 2)
const getMultipliers = (diff) => {
    const bases = {
        easy: 1.25,    // 80% win rate per row (4 safe, 1 mine)
        medium: 1.67,  // 60% win rate per row (3 safe, 2 mines)
        hard: 2.5      // 40% win rate per row (2 safe, 3 mines)
    };
    const base = bases[diff] || bases.easy;
    return Array.from({ length: 10 }, (_, i) =>
        Math.round(Math.pow(base, i + 1) * 100) / 100
    );
};

const TowerGame = () => {
    const { user, refreshUser } = useContext(AuthContext);

    // Game state
    const [gameId, setGameId] = useState(null);
    const [gameStatus, setGameStatus] = useState('idle'); // idle, active, won, lost
    const [betAmount, setBetAmount] = useState(100);
    const [difficulty, setDifficulty] = useState('easy');

    // Tower state
    const [currentRow, setCurrentRow] = useState(0);
    const [grid, setGrid] = useState(
        Array(GRID_ROWS).fill(null).map(() =>
            Array(GRID_COLS).fill({ revealed: false, isSafe: false, isMine: false })
        )
    );

    // Multiplier state
    const [currentMultiplier, setCurrentMultiplier] = useState(1.0);
    const [nextMultiplier, setNextMultiplier] = useState(1.21);

    // UI state
    const [isLoading, setIsLoading] = useState(false);
    const [isRevealing, setIsRevealing] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);

    // Calculate values
    const isValidBet = betAmount >= MIN_BET && betAmount <= (user?.cash || 0);
    const canCashOut = gameStatus === 'active' && currentRow > 0;

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
            const res = await api.get('/games/tower/active');
            if (res.data.success && res.data.hasActiveGame) {
                setGameId(res.data.gameId);
                setGameStatus('active');
                setBetAmount(res.data.betAmount);
                setDifficulty(res.data.difficulty);
                setCurrentRow(res.data.currentRow);
                setCurrentMultiplier(res.data.currentMultiplier);
                setNextMultiplier(res.data.nextMultiplier);

                // Don't restore revealed tiles for security - just show current row as active
                const newGrid = Array(GRID_ROWS).fill(null).map(() =>
                    Array(GRID_COLS).fill({ revealed: false, isSafe: false, isMine: false })
                );
                setGrid(newGrid);
            }
        } catch (err) {
            console.error('Failed to check active game:', err);
        }
    };

    const startGame = async () => {
        if (!isValidBet) return;
        setIsLoading(true);

        try {
            const res = await api.post('/games/tower/start', { betAmount, difficulty });
            if (res.data.success) {
                setGameId(res.data.gameId);
                setGameStatus('active');
                setCurrentRow(0);
                setCurrentMultiplier(1.0);
                setNextMultiplier(res.data.nextMultiplier);
                setGrid(
                    Array(GRID_ROWS).fill(null).map(() =>
                        Array(GRID_COLS).fill({ revealed: false, isSafe: false, isMine: false })
                    )
                );
                refreshUser();
            }
        } catch (err) {
            console.error('Start game error:', err);
            alert(err.response?.data?.message || 'Failed to start game');
        } finally {
            setIsLoading(false);
        }
    };

    const climbTower = async (colIndex) => {
        if (gameStatus !== 'active' || isRevealing) return;
        setIsRevealing(true);

        try {
            const res = await api.post('/games/tower/climb', { gameId, selectedColIndex: colIndex });
            if (res.data.success) {
                const newGrid = [...grid];

                if (res.data.result === 'boom') {
                    // Hit mine - reveal all mines
                    newGrid[currentRow][colIndex] = { revealed: true, isSafe: false, isMine: true };
                    res.data.minePositions.forEach(pos => {
                        newGrid[pos.row][pos.col] = { ...newGrid[pos.row][pos.col], revealed: true, isMine: true };
                    });
                    setGrid(newGrid);
                    setGameStatus('lost');
                    refreshUser();
                } else if (res.data.result === 'safe') {
                    // Safe tile - reveal and move to next row
                    newGrid[currentRow][colIndex] = { revealed: true, isSafe: true, isMine: false };
                    setGrid(newGrid);
                    setCurrentRow(res.data.currentRow);
                    setCurrentMultiplier(res.data.currentMultiplier);
                    setNextMultiplier(res.data.nextMultiplier);
                } else if (res.data.result === 'cashout') {
                    // All rows completed - auto cashout
                    newGrid[currentRow][colIndex] = { revealed: true, isSafe: true, isMine: false };
                    res.data.minePositions.forEach(pos => {
                        newGrid[pos.row][pos.col] = { ...newGrid[pos.row][pos.col], revealed: true, isMine: true };
                    });
                    setGrid(newGrid);
                    setGameStatus('won');
                    setCurrentMultiplier(res.data.multiplier);
                    setShowConfetti(true);
                    refreshUser();
                }
            }
        } catch (err) {
            console.error('Climb error:', err);
            alert(err.response?.data?.message || 'Failed to climb tower');
        } finally {
            setIsRevealing(false);
        }
    };

    const cashOut = async () => {
        if (!canCashOut) return;
        setIsLoading(true);

        try {
            const res = await api.post('/games/tower/cashout', { gameId });
            if (res.data.success) {
                const newGrid = [...grid];
                res.data.minePositions.forEach(pos => {
                    newGrid[pos.row][pos.col] = { ...newGrid[pos.row][pos.col], revealed: true, isMine: true };
                });
                setGrid(newGrid);
                setGameStatus('won');
                setCurrentMultiplier(res.data.multiplier);
                setShowConfetti(true);
                refreshUser();
            }
        } catch (err) {
            console.error('Cashout error:', err);
            alert(err.response?.data?.message || 'Failed to cash out');
        } finally {
            setIsLoading(false);
        }
    };

    const resetGame = () => {
        setGameId(null);
        setGameStatus('idle');
        setCurrentRow(0);
        setGrid(
            Array(GRID_ROWS).fill(null).map(() =>
                Array(GRID_COLS).fill({ revealed: false, isSafe: false, isMine: false })
            )
        );
        setCurrentMultiplier(1.0);
        setNextMultiplier(1.21);
    };

    const renderTile = (rowIndex, colIndex) => {
        const tile = grid[rowIndex][colIndex];
        const isCurrentRow = rowIndex === currentRow && gameStatus === 'active';
        const isPastRow = rowIndex < currentRow;
        const isFutureRow = rowIndex > currentRow;

        let tileClass = 'tower-tile';
        let content = '';

        if (tile.revealed) {
            if (tile.isSafe) {
                tileClass += ' safe';
                content = '⭐';
            } else if (tile.isMine) {
                tileClass += ' mine';
                content = '💣';
            }
        } else if (isCurrentRow) {
            tileClass += ' active';
        } else if (isFutureRow) {
            tileClass += ' locked';
        } else if (isPastRow) {
            tileClass += ' passed';
        }

        return (
            <button
                key={`${rowIndex}-${colIndex}`}
                className={tileClass}
                onClick={() => climbTower(colIndex)}
                disabled={!isCurrentRow || isRevealing || tile.revealed}
            >
                <span className="tile-content">{content}</span>
                <div className="tile-glow"></div>
            </button>
        );
    };

    const renderMultiplierPill = (index) => {
        const rowNumber = index; // 0-9
        const multipliers = getMultipliers(difficulty);
        const multiplier = multipliers[index];
        const isActive = rowNumber === currentRow && gameStatus === 'active';
        const isPassed = rowNumber < currentRow;

        return (
            <div
                key={index}
                className={`multiplier-pill ${isActive ? 'active' : ''} ${isPassed ? 'passed' : ''}`}
            >
                <span className="mult-value">{multiplier.toFixed(2)}x</span>
            </div>
        );
    };

    return (
        <div className="tower-wrapper">
            {/* Confetti Effect */}
            {showConfetti && (
                <div className="confetti-container">
                    {[...Array(50)].map((_, i) => (
                        <div
                            key={i}
                            className="confetti"
                            style={{
                                left: `${Math.random() * 100}%`,
                                animationDelay: `${Math.random() * 2}s`,
                                backgroundColor: ['#FFD700', '#00FF88', '#FF6B6B', '#8a2be2'][
                                    Math.floor(Math.random() * 4)
                                ],
                            }}
                        ></div>
                    ))}
                </div>
            )}

            <div className="tower-container">
                {/* LEFT PANEL - Controls */}
                <div className="tower-panel">
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
                                        onChange={(e) =>
                                            setBetAmount(Math.max(0, parseFloat(e.target.value) || 0))
                                        }
                                        min={MIN_BET}
                                    />
                                </div>
                                {!isValidBet && (
                                    <span className="error-text">
                                        Min ${MIN_BET}, Max ${user?.cash?.toFixed(2) || 0}
                                    </span>
                                )}
                            </div>

                            {/* Difficulty Selector */}
                            <div className="input-group">
                                <div className="input-label">
                                    <span>Difficulty</span>
                                </div>
                                <div className="select-wrapper">
                                    <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                                        <option value="easy">Easy (4 Safe, 1 Mine)</option>
                                        <option value="medium">Medium (3 Safe, 2 Mines)</option>
                                        <option value="hard">Hard (2 Safe, 3 Mines)</option>
                                    </select>
                                    <span className="select-arrow">▼</span>
                                </div>
                            </div>

                            {/* Bet Button */}
                            <button className="bet-button" onClick={startGame} disabled={isLoading || !isValidBet}>
                                <span className="btn-glow"></span>
                                {isLoading ? <span className="spinner"></span> : 'BET'}
                            </button>
                        </>
                    ) : (
                        <>
                            {/* Game Stats */}
                            <div className="game-stats">
                                <div className="stat-row">
                                    <span>Bet</span>
                                    <span className="stat-value">${betAmount.toFixed(2)}</span>
                                </div>
                                <div className="stat-row">
                                    <span>Difficulty</span>
                                    <span className="stat-value">{difficulty.toUpperCase()}</span>
                                </div>
                                <div className="stat-row">
                                    <span>Current Row</span>
                                    <span className="stat-value success">{currentRow + 1}/10</span>
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
                                <button
                                    className={`cashout-button ${canCashOut ? 'ready' : ''}`}
                                    onClick={cashOut}
                                    disabled={isLoading || !canCashOut}
                                >
                                    <span className="btn-glow"></span>
                                    {canCashOut
                                        ? `CASH OUT  $${(betAmount * currentMultiplier).toFixed(2)}`
                                        : 'Pick a tile to start'}
                                </button>
                            ) : (
                                <button className={`result-button ${gameStatus}`} onClick={resetGame}>
                                    {gameStatus === 'won' ? '🎉 Play Again' : '💀 Try Again'}
                                </button>
                            )}

                            {/* Profit Display */}
                            <div className="profit-section">
                                <div className="profit-header">
                                    <span>Potential Profit</span>
                                    <span className="profit-mult">({currentMultiplier.toFixed(2)}×)</span>
                                </div>
                                <div className={`profit-display ${currentRow > 0 ? 'positive' : ''}`}>
                                    <span className="cash-icon">🪙</span>
                                    <span className="profit-amount">
                                        {currentRow > 0 ? '+' : ''}
                                        {(betAmount * currentMultiplier - betAmount).toFixed(2)}
                                    </span>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* RIGHT AREA - Game Grid */}
                <div className="tower-game-area">
                    {/* Header */}
                    <div className="game-header">
                        <h2 className="game-title">🗼 TOWER</h2>
                    </div>

                    {/* Tower Grid with Multipliers */}
                    <div className="tower-grid-container">
                        {/* Multiplier Column - Aligned with rows */}
                        <div className="multiplier-column">
                            {[...Array(10)].map((_, i) => renderMultiplierPill(9 - i))}
                        </div>

                        {/* Tower Grid */}
                        <div className="tower-grid">
                            {[...Array(GRID_ROWS)].reverse().map((_, rowIdx) => {
                                const actualRow = GRID_ROWS - 1 - rowIdx;
                                return (
                                    <div key={actualRow} className="tower-row">
                                        {grid[actualRow].map((_, colIdx) => renderTile(actualRow, colIdx))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Result Banner */}
                    {(gameStatus === 'won' || gameStatus === 'lost') && (
                        <div className={`result-banner ${gameStatus}`}>
                            {gameStatus === 'won' ? (
                                <>
                                    🎉 You Won{' '}
                                    <span className="win-amount">
                                        ${(betAmount * currentMultiplier).toFixed(2)}
                                    </span>
                                    !
                                </>
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

export default TowerGame;
