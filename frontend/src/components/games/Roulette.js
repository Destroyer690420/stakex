import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import api from '../../services/api';
import './Roulette.css';

// Roulette constants
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const CHIP_VALUES = [1, 5, 10, 25, 50, 100, 500, 1000];

// Wheel order (European)
const WHEEL_ORDER = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const getColor = (num) => {
    if (num === 0) return 'green';
    return RED_NUMBERS.includes(num) ? 'red' : 'black';
};

const Roulette = () => {
    const { user, refreshUser } = useContext(AuthContext);

    // State
    const [selectedChip, setSelectedChip] = useState(10);
    const [bets, setBets] = useState([]);
    const [spinning, setSpinning] = useState(false);
    const [result, setResult] = useState(null);
    const [lastWin, setLastWin] = useState(null);
    const [history, setHistory] = useState([]);
    const [wheelRotation, setWheelRotation] = useState(0);
    const [message, setMessage] = useState('');

    // Calculate total bet
    const totalBet = bets.reduce((sum, b) => sum + b.amount, 0);

    // Fetch history on mount
    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        try {
            const res = await api.get('/games/roulette/history');
            if (res.data.success) {
                setHistory(res.data.history);
            }
        } catch (err) {
            console.error('Failed to fetch history');
        }
    };

    // Place a bet
    const placeBet = (type, value) => {
        if (spinning) return;

        // Check if bet already exists
        const existingBetIndex = bets.findIndex(b =>
            b.type === type && JSON.stringify(b.value) === JSON.stringify(value)
        );

        if (existingBetIndex >= 0) {
            // Add to existing bet
            const newBets = [...bets];
            newBets[existingBetIndex].amount += selectedChip;
            setBets(newBets);
        } else {
            // New bet
            setBets([...bets, { type, value, amount: selectedChip }]);
        }
    };

    // Clear all bets
    const clearBets = () => {
        if (!spinning) {
            setBets([]);
            setResult(null);
            setLastWin(null);
            setMessage('');
        }
    };

    // Double bets
    const doubleBets = () => {
        if (!spinning && bets.length > 0) {
            const doubled = bets.map(b => ({ ...b, amount: b.amount * 2 }));
            setBets(doubled);
        }
    };

    // Undo last bet
    const undoLastBet = () => {
        if (!spinning && bets.length > 0) {
            setBets(bets.slice(0, -1));
        }
    };

    // Spin the wheel
    const spin = async () => {
        if (spinning || bets.length === 0) return;
        if (totalBet > (user?.cash || 0)) {
            setMessage('Insufficient balance!');
            return;
        }

        setSpinning(true);
        setResult(null);
        setLastWin(null);
        setMessage('');

        try {
            // Format bets for API
            const formattedBets = bets.map(b => ({
                type: b.type,
                value: Array.isArray(b.value) ? b.value : [b.value],
                amount: b.amount
            }));

            const res = await api.post('/games/roulette/spin', { bets: formattedBets });

            if (res.data.success) {
                // Animate wheel
                const resultNum = res.data.result;
                const resultIndex = WHEEL_ORDER.indexOf(resultNum);
                const degreesPerNumber = 360 / 37;
                const targetRotation = 360 * 5 + (360 - resultIndex * degreesPerNumber);

                setWheelRotation(prev => prev + targetRotation);

                // Wait for animation
                setTimeout(() => {
                    setResult(resultNum);
                    setSpinning(false);
                    refreshUser();

                    if (res.data.totalWin > 0) {
                        setLastWin(res.data.totalWin);
                        setMessage(`🎉 You won $${res.data.totalWin.toFixed(2)}!`);
                    } else {
                        setMessage(`Result: ${resultNum} ${getColor(resultNum)}`);
                    }

                    // Update history
                    setHistory(prev => [{
                        result: resultNum,
                        color: getColor(resultNum)
                    }, ...prev].slice(0, 20));

                }, 4000);
            } else {
                setSpinning(false);
                setMessage(res.data.message || 'Spin failed');
            }
        } catch (err) {
            setSpinning(false);
            setMessage(err.response?.data?.message || 'Spin failed');
        }
    };

    // Render betting board number
    const renderNumber = (num) => {
        const color = getColor(num);
        const betOnThis = bets.find(b => b.type === 'straight' && b.value === num);

        return (
            <div
                key={num}
                className={`board-number ${color} ${result === num ? 'winner' : ''}`}
                onClick={() => placeBet('straight', num)}
            >
                <span>{num}</span>
                {betOnThis && (
                    <div className="chip-on-board">
                        ${betOnThis.amount}
                    </div>
                )}
            </div>
        );
    };

    // Render outside bet
    const renderOutsideBet = (type, label, className = '') => {
        const betOnThis = bets.find(b => b.type === type);

        return (
            <div
                className={`outside-bet ${className} ${bets.some(b => b.type === type) ? 'has-bet' : ''}`}
                onClick={() => placeBet(type, type)}
            >
                <span>{label}</span>
                {betOnThis && (
                    <div className="chip-on-board">
                        ${betOnThis.amount}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="roulette-container">
            {/* Header */}
            <div className="roulette-header">
                <h1>🎰 European Roulette</h1>
                <div className="balance-display">
                    <span>Balance:</span>
                    <span className="balance-amount">${user?.cash?.toFixed(2) || '0.00'}</span>
                </div>
            </div>

            {/* Message */}
            {message && (
                <div className={`roulette-message ${lastWin ? 'win' : ''}`}>
                    {message}
                </div>
            )}

            {/* Main Game Area */}
            <div className="roulette-game">
                {/* Wheel Section */}
                <div className="wheel-section">
                    <div className="wheel-container">
                        <div className="wheel-pointer">▼</div>
                        <div
                            className={`roulette-wheel ${spinning ? 'spinning' : ''}`}
                            style={{ transform: `rotate(${wheelRotation}deg)` }}
                        >
                            {WHEEL_ORDER.map((num, index) => (
                                <div
                                    key={num}
                                    className={`wheel-number ${getColor(num)}`}
                                    style={{
                                        transform: `rotate(${index * (360 / 37)}deg) translateY(-120px)`
                                    }}
                                >
                                    {num}
                                </div>
                            ))}
                            <div className="wheel-center">
                                {result !== null && !spinning && (
                                    <div className={`result-display ${getColor(result)}`}>
                                        {result}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* History Strip */}
                    <div className="history-strip">
                        <span className="history-label">Last Results:</span>
                        <div className="history-numbers">
                            {history.slice(0, 15).map((h, i) => (
                                <div key={i} className={`history-num ${h.color}`}>
                                    {h.result}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Betting Board */}
                <div className="betting-board">
                    {/* Zero */}
                    <div className="zero-section">
                        {renderNumber(0)}
                    </div>

                    {/* Number Grid */}
                    <div className="numbers-grid">
                        {[...Array(12)].map((_, col) => (
                            <div key={col} className="number-column">
                                {[3, 2, 1].map(row => {
                                    const num = col * 3 + row;
                                    return renderNumber(num);
                                })}
                            </div>
                        ))}
                    </div>

                    {/* Column Bets */}
                    <div className="column-bets">
                        {renderOutsideBet('column1', '2:1', 'column-bet')}
                        {renderOutsideBet('column2', '2:1', 'column-bet')}
                        {renderOutsideBet('column3', '2:1', 'column-bet')}
                    </div>

                    {/* Dozen Bets */}
                    <div className="dozen-bets">
                        {renderOutsideBet('dozen1', '1st 12', 'dozen-bet')}
                        {renderOutsideBet('dozen2', '2nd 12', 'dozen-bet')}
                        {renderOutsideBet('dozen3', '3rd 12', 'dozen-bet')}
                    </div>

                    {/* Even Money Bets */}
                    <div className="even-bets">
                        {renderOutsideBet('low', '1-18')}
                        {renderOutsideBet('even', 'EVEN')}
                        {renderOutsideBet('red', '', 'red-bet')}
                        {renderOutsideBet('black', '', 'black-bet')}
                        {renderOutsideBet('odd', 'ODD')}
                        {renderOutsideBet('high', '19-36')}
                    </div>
                </div>
            </div>

            {/* Controls */}
            <div className="roulette-controls">
                {/* Chip Selector */}
                <div className="chip-selector">
                    {CHIP_VALUES.map(value => (
                        <button
                            key={value}
                            className={`chip ${selectedChip === value ? 'selected' : ''}`}
                            onClick={() => setSelectedChip(value)}
                            disabled={spinning}
                        >
                            ${value}
                        </button>
                    ))}
                </div>

                {/* Action Buttons */}
                <div className="action-buttons">
                    <button
                        className="btn-action btn-clear"
                        onClick={clearBets}
                        disabled={spinning || bets.length === 0}
                    >
                        Clear
                    </button>
                    <button
                        className="btn-action btn-undo"
                        onClick={undoLastBet}
                        disabled={spinning || bets.length === 0}
                    >
                        Undo
                    </button>
                    <button
                        className="btn-action btn-double"
                        onClick={doubleBets}
                        disabled={spinning || bets.length === 0}
                    >
                        2x
                    </button>
                </div>

                {/* Spin Button */}
                <div className="spin-section">
                    <div className="bet-total">
                        Total Bet: <span className="amount">${totalBet}</span>
                    </div>
                    <button
                        className={`btn-spin ${spinning ? 'spinning' : ''}`}
                        onClick={spin}
                        disabled={spinning || bets.length === 0}
                    >
                        {spinning ? '🎰 SPINNING...' : '🎲 SPIN'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Roulette;
