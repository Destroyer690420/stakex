import React, { useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import toast, { Toaster } from 'react-hot-toast';
import './CoinFlip.css';

const CoinFlipLobby = () => {
    const { user, updateUser } = useContext(AuthContext);
    const [betAmount, setBetAmount] = useState(100);
    const [selectedSide, setSelectedSide] = useState('heads');
    const [flipping, setFlipping] = useState(false);
    const [coinState, setCoinState] = useState('idle'); // idle, spinning, result-heads, result-tails
    const [result, setResult] = useState(null);
    const [lastWin, setLastWin] = useState(0);

    const handleFlip = async () => {
        if (flipping) return;

        // Validate bet
        if (betAmount < 10) {
            toast.error('Minimum bet is $10');
            return;
        }
        if (betAmount > 10000) {
            toast.error('Maximum bet is $10,000');
            return;
        }
        if (betAmount > user.cash) {
            toast.error('Insufficient balance!', {
                icon: '💸',
                style: {
                    background: '#0f0f0f',
                    color: '#fff',
                    border: '1px solid #ff4757'
                }
            });
            return;
        }

        setFlipping(true);
        setResult(null);
        setLastWin(0);
        setCoinState('spinning');

        try {
            const { data, error } = await supabase.rpc('fn_flip_coin', {
                p_user_id: user.id,
                p_bet_amount: betAmount,
                p_chosen_side: selectedSide
            });

            if (error) throw error;

            if (!data.success) {
                setCoinState('idle');
                setFlipping(false);
                toast.error(data.error || 'Flip failed');
                return;
            }

            // Wait for spin animation (1.5s), then land
            setTimeout(() => {
                setCoinState(`result-${data.flipResult}`);

                // After coin lands (1s), show result
                setTimeout(() => {
                    setResult(data);
                    setFlipping(false);
                    updateUser({ cash: data.newBalance });

                    if (data.won) {
                        setLastWin(data.payout);
                        toast.success(`🎉 You won $${data.payout.toFixed(2)}!`, {
                            duration: 3000,
                            style: {
                                background: '#0f0f0f',
                                color: '#d4af37',
                                border: '1px solid #d4af37'
                            }
                        });
                    }
                }, 1000);
            }, 1500);

        } catch (error) {
            console.error('Flip error:', error);
            setCoinState('idle');
            setFlipping(false);
            toast.error(error.message || 'Flip failed');
        }
    };

    const adjustBet = (multiplier) => {
        const newBet = Math.max(10, Math.floor(betAmount * multiplier));
        setBetAmount(Math.min(newBet, user?.cash || 10000, 10000));
    };

    const resetGame = () => {
        setCoinState('idle');
        setResult(null);
    };

    return (
        <div className="coinflip-wrapper">
            <Toaster position="top-center" />

            <div className="coinflip-solo-container">
                {/* Control Panel (Left) */}
                <div className="coinflip-panel">
                    <div className="panel-watermark">STAKEX</div>

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
                                <div className="input-field">
                                    <span className="cash-icon">💰</span>
                                    <input
                                        type="number"
                                        value={betAmount}
                                        onChange={e => setBetAmount(parseFloat(e.target.value) || 0)}
                                        disabled={flipping}
                                        min="10"
                                        max="10000"
                                    />
                                </div>
                            </div>
                            <div className="quick-btns">
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(0.5)}
                                    disabled={flipping}
                                >
                                    ½
                                </button>
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(2)}
                                    disabled={flipping}
                                >
                                    2×
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Side Selection */}
                    <div className="input-group">
                        <label className="input-label">Choose Your Side</label>
                        <div className="side-selector">
                            <div
                                className={`side-option ${selectedSide === 'heads' ? 'selected heads' : ''}`}
                                onClick={() => !flipping && setSelectedSide('heads')}
                            >
                                <div className="side-option-icon">🟢</div>
                                <div className="side-option-label">HEADS</div>
                            </div>
                            <div
                                className={`side-option ${selectedSide === 'tails' ? 'selected tails' : ''}`}
                                onClick={() => !flipping && setSelectedSide('tails')}
                            >
                                <div className="side-option-icon">⚪</div>
                                <div className="side-option-label">TAILS</div>
                            </div>
                        </div>
                    </div>

                    {/* Flip Button */}
                    <button
                        className={`flip-button ${flipping ? 'flipping' : ''}`}
                        onClick={handleFlip}
                        disabled={flipping}
                    >
                        {flipping ? (
                            <span className="spinner"></span>
                        ) : (
                            <>
                                <span className="btn-glow"></span>
                                FLIP
                            </>
                        )}
                    </button>

                    {/* Payout Info */}
                    <div className="payout-info">
                        <div className="payout-row">
                            <span>Multiplier</span>
                            <span className="payout-value">1.98×</span>
                        </div>
                        <div className="payout-row">
                            <span>Potential Win</span>
                            <span className="payout-value win">
                                ${(betAmount * 1.98).toFixed(2)}
                            </span>
                        </div>
                    </div>

                    {/* Last Win */}
                    {lastWin > 0 && (
                        <div className="last-win">
                            <span className="win-label">LAST WIN</span>
                            <span className="win-amount">${lastWin.toFixed(2)}</span>
                        </div>
                    )}
                </div>

                {/* Game Area (Right) */}
                <div className="coinflip-game-area">
                    <div className="game-header">
                        <h1 className="game-title">🪙 COIN FLIP</h1>
                        <p className="game-subtitle">50/50 Chance • 1.98× Payout</p>
                    </div>

                    {/* 3D Coin */}
                    <div className="coin-stage-solo">
                        <div className={`coin-3d-solo ${coinState}`}>
                            <div className="coin-face-solo coin-heads-solo">
                                <span>H</span>
                            </div>
                            <div className="coin-face-solo coin-tails-solo">
                                <span>T</span>
                            </div>
                        </div>
                    </div>

                    {/* Result Display */}
                    {result && (
                        <div className={`result-display-solo ${result.won ? 'won' : 'lost'}`}>
                            <div className="result-icon">
                                {result.won ? '🎉' : '😔'}
                            </div>
                            <div className="result-text-solo">
                                {result.won ? 'YOU WON!' : 'YOU LOST'}
                            </div>
                            <div className="result-details">
                                Coin landed on <strong>{result.flipResult.toUpperCase()}</strong>
                            </div>
                            {result.won && (
                                <div className="result-payout">
                                    +${result.payout.toFixed(2)}
                                </div>
                            )}
                            <button className="play-again-btn" onClick={resetGame}>
                                Play Again
                            </button>
                        </div>
                    )}

                    {/* Instructions when idle */}
                    {coinState === 'idle' && !result && (
                        <div className="game-instructions">
                            <p>Choose your side and bet amount</p>
                            <p>Click <strong>FLIP</strong> to test your luck!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CoinFlipLobby;
