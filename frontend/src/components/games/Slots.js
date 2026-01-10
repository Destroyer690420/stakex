import React, { useState, useContext, useRef } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';

const Slots = () => {
    const { user, updateUser } = useContext(AuthContext);
    const [betAmount, setBetAmount] = useState(10);
    const [spinning, setSpinning] = useState(false);
    // 3x3 Grid
    const [grid, setGrid] = useState([
        ['❓', '❓', '❓'],
        ['❓', '❓', '❓'],
        ['❓', '❓', '❓']
    ]);
    const [message, setMessage] = useState('');
    const [winAmount, setWinAmount] = useState(0);

    // Symbols matching backend
    const SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐'];

    // Intervals for 3 columns (reels) - we animate columns, not rows
    const reelIntervals = useRef([]);

    const handleSpin = async () => {
        if (spinning) return;
        if (betAmount > user.cash) {
            setMessage('Insufficient funds!');
            return;
        }

        setSpinning(true);
        setMessage('');
        setWinAmount(0);

        // Start animation: We simulate 3 reels spinning independently
        // For visual, we update the whole grid randomly
        reelIntervals.current = [0, 1, 2].map(colIndex => {
            return setInterval(() => {
                setGrid(prev => {
                    const newGrid = prev.map(row => [...row]);
                    // Randomize this column in all 3 rows
                    for (let r = 0; r < 3; r++) {
                        newGrid[r][colIndex] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
                    }
                    return newGrid;
                });
            }, 100 + (colIndex * 20)); // Stagger slightly
        });

        try {
            // Call API: Correct endpoint
            const response = await api.post('/games/slots/spin', { betAmount });
            const { result, newCash } = response.data;

            // Delayed stop for effect
            setTimeout(() => {
                clearIntervals();
                setGrid(result.grid); // Backend returns 3x3 grid

                // Update Global User State
                updateUser({ cash: newCash });

                setSpinning(false);
                if (result.won) {
                    setWinAmount(result.payout);
                    setMessage(`WIN! ${result.multiplier}x Multiplier! 🎉`);
                } else {
                    setMessage('No match on middle row. Try again!');
                }

            }, 2000);

        } catch (error) {
            console.error('Spin error:', error);
            clearIntervals();
            setSpinning(false);
            setMessage(error.response?.data?.message || 'Game failed');
        }
    };

    const clearIntervals = () => {
        reelIntervals.current.forEach(clearInterval);
    };

    const handleBetChange = (e) => {
        const val = parseInt(e.target.value);
        if (!isNaN(val) && val >= 0) setBetAmount(val);
    };

    const adjustBet = (multiplier) => {
        setBetAmount(Math.floor(betAmount * multiplier));
    };

    return (
        <div className="slots-container text-center">
            <div className="mb-3 text-white small">
                Match 3 symbols on the <span className="text-warning fw-bold">MIDDLE ROW</span> to win!
            </div>

            {/* 3x3 Reels Grid */}
            <div className="reels-container mb-5 d-inline-block p-3" style={{ background: '#2B3A48', borderRadius: '15px', border: '4px solid #F5C518' }}>
                {grid.map((row, rowIndex) => (
                    <div key={rowIndex} className={`d-flex gap-2 mb-2 ${rowIndex === 1 ? 'middle-row' : ''}`}>
                        {row.map((symbol, colIndex) => (
                            <div key={`${rowIndex}-${colIndex}`}
                                className={`reel-cell ${spinning ? 'spinning' : ''} ${rowIndex === 1 && winAmount > 0 ? 'win-glow' : ''}`}>
                                {symbol}
                            </div>
                        ))}
                    </div>
                ))}

                {/* Payline Indicator */}
                <div className="payline-indicator" style={{ display: 'none' }}></div>
            </div>

            {/* Results */}
            <div className="result-display mb-4" style={{ minHeight: '60px' }}>
                {message && <h3 className={winAmount > 0 ? 'text-success fw-bold' : 'text-danger'}>{message}</h3>}
                {winAmount > 0 && <h2 className="text-success glow-text">+{winAmount}</h2>}
            </div>

            {/* Controls */}
            <div className="controls-container p-4 rounded" style={{ background: 'rgba(0,0,0,0.2)' }}>
                <div className="row justify-content-center align-items-center g-3">
                    <div className="col-auto">
                        <label className="text-muted me-2">Bet Amount</label>
                        <div className="input-group">
                            <button className="btn btn-outline-secondary" onClick={() => adjustBet(0.5)}>1/2</button>
                            <input
                                type="number"
                                className="form-control text-center text-white"
                                style={{ maxWidth: '100px', background: 'transparent', borderColor: '#444' }}
                                value={betAmount}
                                onChange={handleBetChange}
                            />
                            <button className="btn btn-outline-secondary" onClick={() => adjustBet(2)}>2x</button>
                        </div>
                    </div>

                    <div className="col-auto">
                        <button
                            className="btn btn-primary btn-lg px-5 fw-bold"
                            style={{
                                background: spinning ? '#555' : 'linear-gradient(135deg, #00e701 0%, #00b894 100%)',
                                color: spinning ? '#aaa' : '#000',
                                boxShadow: spinning ? 'none' : '0 0 20px rgba(0, 231, 1, 0.4)'
                            }}
                            onClick={handleSpin}
                            disabled={spinning}
                        >
                            {spinning ? 'SPINNING...' : 'SPIN'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Slots;
