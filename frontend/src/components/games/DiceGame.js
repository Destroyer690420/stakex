import React, { useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import './Dice.css';

const MIN_BET = 1;
const MAX_BET = 10000;
const DEFAULT_TARGET = 50.50;

const DiceGame = () => {
    const { user, refreshUser } = useContext(AuthContext);

    // Game state
    const [betAmount, setBetAmount] = useState(100);
    const [target, setTarget] = useState(DEFAULT_TARGET);
    const [isOver, setIsOver] = useState(true);
    const [isRolling, setIsRolling] = useState(false);

    // Result state
    const [result, setResult] = useState(null);
    const [rollPosition, setRollPosition] = useState(null);

    // Calculations
    const winChance = isOver ? parseFloat((99.99 - target).toFixed(2)) : parseFloat(target.toFixed(2));
    const multiplier = winChance > 0 ? parseFloat((99 / winChance).toFixed(4)) : 0;
    const potentialWin = parseFloat((betAmount * multiplier).toFixed(2));

    const isValidBet = betAmount >= MIN_BET && betAmount <= MAX_BET && betAmount <= (user?.cash || 0);
    const isValidTarget = target >= 0.01 && target <= 99.98;

    // Handle target change from slider or input
    const handleTargetChange = (value) => {
        const num = parseFloat(value);
        if (!isNaN(num)) {
            setTarget(Math.max(0.01, Math.min(99.98, parseFloat(num.toFixed(2)))));
        }
    };

    // Handle multiplier change (updates target)
    const handleMultiplierChange = (value) => {
        const mult = parseFloat(value);
        if (mult > 1 && mult <= 9900) {
            const newWinChance = 99 / mult;
            if (isOver) {
                handleTargetChange(99.99 - newWinChance);
            } else {
                handleTargetChange(newWinChance);
            }
        }
    };

    // Handle win chance change (updates target)
    const handleWinChanceChange = (value) => {
        const chance = parseFloat(value);
        if (chance > 0 && chance < 100) {
            if (isOver) {
                handleTargetChange(99.99 - chance);
            } else {
                handleTargetChange(chance);
            }
        }
    };

    // Adjust bet
    const adjustBet = (multiplierFactor) => {
        const newBet = Math.max(MIN_BET, Math.floor(betAmount * multiplierFactor));
        setBetAmount(Math.min(newBet, user?.cash || MAX_BET, MAX_BET));
    };

    // Roll the dice
    const handleRoll = async () => {
        if (isRolling || !isValidBet || !isValidTarget) return;

        setIsRolling(true);
        setResult(null);
        setRollPosition(null);

        try {
            const { data, error } = await supabase.rpc('fn_play_dice', {
                p_user_id: user.id,
                p_bet_amount: betAmount,
                p_target_value: target,
                p_is_over: isOver
            });

            if (error) throw error;

            if (!data.success) {
                toast.error(data.error || 'Roll failed');
                setIsRolling(false);
                return;
            }

            // Simulate rolling animation (number cycling)
            let rollCount = 0;
            const rollInterval = setInterval(() => {
                setRollPosition(parseFloat((Math.random() * 99.99).toFixed(2)));
                rollCount++;
                if (rollCount >= 15) {
                    clearInterval(rollInterval);

                    // Show final result
                    setTimeout(() => {
                        setRollPosition(data.roll);
                        setResult(data);
                        setIsRolling(false);
                        refreshUser();

                        if (data.won) {
                            toast.success(`🎉 You won $${data.payout.toFixed(2)}!`, {
                                duration: 3000,
                                style: {
                                    background: '#0f0f0f',
                                    color: '#00e701',
                                    border: '1px solid #00e701'
                                }
                            });
                        }
                    }, 300);
                }
            }, 50);

        } catch (error) {
            console.error('Dice roll error:', error);
            toast.error(error.message || 'Roll failed');
            setIsRolling(false);
        }
    };

    // Get track segment widths
    const getTrackSegments = () => {
        if (isOver) {
            // Win zone is AFTER target
            return {
                lossWidth: target,
                winWidth: 99.99 - target
            };
        } else {
            // Win zone is BEFORE target
            return {
                winWidth: target,
                lossWidth: 99.99 - target
            };
        }
    };

    const { lossWidth, winWidth } = getTrackSegments();

    return (
        <div className="dice-wrapper">
            <div className="dice-container">
                {/* Control Panel (Left) */}
                <div className="dice-panel">
                    {/* Bet Amount */}
                    <div className="input-group">
                        <div className="input-label">
                            <span>Bet Amount</span>
                            <span className="balance-tag">
                                Balance: ${(user?.cash || 0).toFixed(2)}
                            </span>
                        </div>
                        <div className="bet-input-row">
                            <div className="bet-field">
                                <div className={`input-field ${!isValidBet ? 'error' : ''}`}>
                                    <span className="cash-icon">💰</span>
                                    <input
                                        type="number"
                                        value={betAmount}
                                        onChange={e => setBetAmount(parseFloat(e.target.value) || 0)}
                                        disabled={isRolling}
                                        min={MIN_BET}
                                        max={MAX_BET}
                                        step="1"
                                    />
                                </div>
                            </div>
                            <div className="quick-btns">
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(0.5)}
                                    disabled={isRolling}
                                >
                                    ½
                                </button>
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(2)}
                                    disabled={isRolling}
                                >
                                    2×
                                </button>
                            </div>
                        </div>
                        {!isValidBet && <span className="error-text">Min ${MIN_BET}, Max ${Math.min(MAX_BET, user?.cash || 0).toFixed(2)}</span>}
                    </div>


                    {/* Over/Under Toggle */}
                    <div className="input-group">
                        <div className="input-label">
                            <span>Roll Mode</span>
                        </div>
                        <div className="mode-toggle">
                            <button
                                className={`mode-btn ${isOver ? 'active' : ''}`}
                                onClick={() => !isRolling && setIsOver(true)}
                                disabled={isRolling}
                            >
                                Roll Over
                            </button>
                            <button
                                className={`mode-btn ${!isOver ? 'active' : ''}`}
                                onClick={() => !isRolling && setIsOver(false)}
                                disabled={isRolling}
                            >
                                Roll Under
                            </button>
                        </div>
                    </div>

                    {/* Target Slider */}
                    <div className="input-group target-slider-container">
                        <div className="input-label">
                            <span>Target</span>
                            <span className="balance-tag">{target.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            className="target-slider"
                            min="0.01"
                            max="99.98"
                            step="0.01"
                            value={target}
                            onChange={e => handleTargetChange(e.target.value)}
                            disabled={isRolling}
                        />
                    </div>

                    {/* Roll Button */}
                    <button
                        className="roll-button"
                        onClick={handleRoll}
                        disabled={isRolling || !isValidBet || !isValidTarget}
                    >
                        {isRolling ? (
                            <span className="spinner"></span>
                        ) : (
                            <>
                                <span className="btn-glow"></span>
                                ROLL
                            </>
                        )}
                    </button>

                    {/* Payout Info */}
                    <div className="payout-info">
                        <div className="payout-item">
                            <div className="payout-label">Multiplier</div>
                            <div className="payout-value">{multiplier.toFixed(2)}×</div>
                        </div>
                        <div className="payout-item">
                            <div className="payout-label">Win Chance</div>
                            <div className="payout-value">{winChance.toFixed(2)}%</div>
                        </div>
                        <div className="payout-item">
                            <div className="payout-label">Profit</div>
                            <div className="payout-value win">${potentialWin.toFixed(2)}</div>
                        </div>
                    </div>
                </div>

                {/* Game Area (Right) */}
                <div className="dice-game-area">
                    <div className="game-header">
                        <h1 className="game-title">🎲 DICE</h1>
                        <p className="game-subtitle">
                            Roll {isOver ? 'Over' : 'Under'} {target.toFixed(2)} • {multiplier.toFixed(2)}× Payout
                        </p>
                    </div>

                    {/* Dice Track */}
                    <div className="dice-track-container">
                        <div className="dice-track-labels">
                            <span>0</span>
                            <span>25</span>
                            <span>50</span>
                            <span>75</span>
                            <span>100</span>
                        </div>
                        <div className="dice-track">
                            <div className="track-segments">
                                {isOver ? (
                                    <>
                                        <div
                                            className="track-segment loss"
                                            style={{ width: `${lossWidth}%` }}
                                        />
                                        <div
                                            className="track-segment win"
                                            style={{ width: `${winWidth}%` }}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <div
                                            className="track-segment win"
                                            style={{ width: `${winWidth}%` }}
                                        />
                                        <div
                                            className="track-segment loss"
                                            style={{ width: `${lossWidth}%` }}
                                        />
                                    </>
                                )}
                            </div>

                            {/* Target Line */}
                            <div
                                className="track-target"
                                style={{ left: `${target}%` }}
                            />

                            {/* Result Pointer */}
                            {rollPosition !== null && (
                                <div
                                    className="result-pointer"
                                    style={{ left: `${rollPosition}%` }}
                                >
                                    <div className={`pointer-diamond ${result ? (result.won ? 'win' : 'loss') : ''}`}>
                                        <span className="pointer-value">
                                            {rollPosition.toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Target Display */}
                    <div className="target-display">
                        <div className="target-text">
                            Roll {isOver ? 'Over' : 'Under'}
                        </div>
                        <div className="target-value">
                            {target.toFixed(2)}
                        </div>
                    </div>

                    {/* Result Banner */}
                    {result && !isRolling && (
                        <div className={`result-banner ${result.won ? 'won' : 'lost'}`}>
                            {result.won ? (
                                <>🎉 You Won <span className="win-amount">${result.payout.toFixed(2)}</span>!</>
                            ) : (
                                <>💔 Rolled {result.roll.toFixed(2)} - Better luck next time!</>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DiceGame;
