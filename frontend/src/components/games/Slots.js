import React, { useState, useContext, useRef, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import toast, { Toaster } from 'react-hot-toast';
import './Slots.css';

const Slots = () => {
    const { user, updateUser } = useContext(AuthContext);
    const [betAmount, setBetAmount] = useState(100);
    const [spinning, setSpinning] = useState(false);
    const [reels, setReels] = useState(['❓', '❓', '❓']);
    const [result, setResult] = useState(null);
    const [lastWin, setLastWin] = useState(0);

    // Symbols for animation
    const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];

    // Refs for reel animation
    const reelRefs = [useRef(null), useRef(null), useRef(null)];
    const animationRefs = useRef([]);

    // Cleanup animations on unmount
    useEffect(() => {
        return () => {
            animationRefs.current.forEach(clearInterval);
        };
    }, []);

    const handleSpin = async () => {
        if (spinning) return;

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
            toast.error('Insufficient balance!');
            return;
        }

        setSpinning(true);
        setResult(null);
        setLastWin(0);

        // Start spinning animation for each reel
        animationRefs.current = reelRefs.map((_, index) => {
            return setInterval(() => {
                setReels(prev => {
                    const newReels = [...prev];
                    newReels[index] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
                    return newReels;
                });
            }, 80 + index * 20);
        });

        try {
            const response = await api.post('/games/slots/spin', { betAmount });
            const { result: spinResult, newCash } = response.data;

            // Stop reels sequentially with delays
            const stopDelays = [800, 1200, 1600];

            spinResult.symbols.forEach((symbol, index) => {
                setTimeout(() => {
                    clearInterval(animationRefs.current[index]);
                    setReels(prev => {
                        const newReels = [...prev];
                        newReels[index] = symbol;
                        return newReels;
                    });

                    // Add bounce class
                    if (reelRefs[index].current) {
                        reelRefs[index].current.classList.add('bounce');
                        setTimeout(() => {
                            reelRefs[index].current?.classList.remove('bounce');
                        }, 400);
                    }
                }, stopDelays[index]);
            });

            // After all reels stop
            setTimeout(() => {
                setSpinning(false);
                updateUser({ cash: newCash });
                setResult(spinResult);

                if (spinResult.won) {
                    setLastWin(spinResult.payout);
                    toast.success(`🎉 You won $${spinResult.payout.toFixed(2)}! (${spinResult.multiplier}x)`, {
                        duration: 3000,
                        icon: '🎰'
                    });
                }
            }, 1800);

        } catch (error) {
            // Stop all animations on error
            animationRefs.current.forEach(clearInterval);
            setSpinning(false);
            setReels(['❓', '❓', '❓']);

            const message = error.response?.data?.message || 'Spin failed. Please try again.';
            toast.error(message);
        }
    };

    const handleBetChange = (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) setBetAmount(val);
    };

    const adjustBet = (multiplier) => {
        const newBet = Math.max(10, Math.floor(betAmount * multiplier));
        setBetAmount(Math.min(newBet, user?.cash || 10000));
    };

    const setMaxBet = () => {
        setBetAmount(Math.min(user?.cash || 10000, 10000));
    };

    return (
        <div className="slots-wrapper">
            <Toaster position="top-center" />

            <div className="slots-container">
                {/* Control Panel (Left) */}
                <div className="slots-panel">
                    <div className="panel-watermark">STAKEX</div>

                    {/* Bet Amount Input */}
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
                                        onChange={handleBetChange}
                                        disabled={spinning}
                                        min="10"
                                        max="10000"
                                        step="10"
                                    />
                                </div>
                            </div>
                            <div className="quick-btns">
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(0.5)}
                                    disabled={spinning}
                                >
                                    ½
                                </button>
                                <button
                                    className="quick-btn"
                                    onClick={() => adjustBet(2)}
                                    disabled={spinning}
                                >
                                    2×
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Quick Bet Buttons */}
                    <div className="quick-bet-row">
                        <button
                            className="preset-btn"
                            onClick={() => setBetAmount(10)}
                            disabled={spinning}
                        >
                            $10
                        </button>
                        <button
                            className="preset-btn"
                            onClick={() => setBetAmount(50)}
                            disabled={spinning}
                        >
                            $50
                        </button>
                        <button
                            className="preset-btn"
                            onClick={() => setBetAmount(100)}
                            disabled={spinning}
                        >
                            $100
                        </button>
                        <button
                            className="preset-btn max"
                            onClick={setMaxBet}
                            disabled={spinning}
                        >
                            MAX
                        </button>
                    </div>

                    {/* Spin Button */}
                    <button
                        className={`bet-button ${spinning ? 'spinning' : ''}`}
                        onClick={handleSpin}
                        disabled={spinning}
                    >
                        {spinning ? (
                            <span className="spinner"></span>
                        ) : (
                            <>
                                <span className="btn-glow"></span>
                                BET
                            </>
                        )}
                    </button>

                    {/* Paytable */}
                    <div className="paytable">
                        <div className="paytable-title">PAYOUTS</div>
                        <div className="paytable-row jackpot">
                            <span>7️⃣ 7️⃣ 7️⃣</span>
                            <span className="payout">20×</span>
                        </div>
                        <div className="paytable-row diamond">
                            <span>💎 💎 💎</span>
                            <span className="payout">10×</span>
                        </div>
                        <div className="paytable-row">
                            <span>Any 3 Match</span>
                            <span className="payout">5×</span>
                        </div>
                        <div className="paytable-row">
                            <span>2 Matching</span>
                            <span className="payout">1.5×</span>
                        </div>
                    </div>

                    {/* Last Win Display */}
                    {lastWin > 0 && (
                        <div className="last-win">
                            <span className="win-label">LAST WIN</span>
                            <span className="win-amount">${lastWin.toFixed(2)}</span>
                        </div>
                    )}
                </div>

                {/* Reels Area (Right) */}
                <div className="slots-reels-area">
                    <div className="slots-machine">
                        <div className="machine-header">
                            <span className="machine-title">🎰 SLOTS 🎰</span>
                        </div>

                        <div className="reels-container">
                            {reels.map((symbol, index) => (
                                <div
                                    key={index}
                                    ref={reelRefs[index]}
                                    className={`reel ${spinning ? 'spinning' : ''} ${result?.won ? 'win' : ''}`}
                                >
                                    <div className="reel-inner">
                                        <span className="symbol">{symbol}</span>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Win Line Indicator */}
                        <div className={`win-line ${result?.won ? 'active' : ''}`}></div>

                        {/* Result Display */}
                        {result && (
                            <div className={`result-display ${result.won ? 'won' : 'lost'}`}>
                                {result.won ? (
                                    <>
                                        <span className="result-text">🎉 WIN!</span>
                                        <span className="result-multiplier">{result.multiplier}×</span>
                                        <span className="result-amount">+${result.payout.toFixed(2)}</span>
                                    </>
                                ) : (
                                    <span className="result-text">No Match</span>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Decorative Elements */}
                    <div className="slots-footer">
                        <div className="footer-info">
                            <span>Min: $10</span>
                            <span>Max: $10,000</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Slots;
