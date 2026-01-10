import React, { useState, useEffect, useContext, useRef } from 'react';
import { io } from 'socket.io-client';
import { AuthContext } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Chat from './Chat';

let socket;

const CoinFlipLobby = () => {
    const { user, refreshUser } = useContext(AuthContext);
    const navigate = useNavigate();

    // Game State
    const [gameState, setGameState] = useState(null);
    const [betAmount, setBetAmount] = useState(10);
    const [myBet, setMyBet] = useState(null);
    const [connected, setConnected] = useState(false);

    // Animation refs
    const coinRef = useRef(null);

    useEffect(() => {
        const socketUrl = 'http://localhost:5000/coinflip';
        socket = io(socketUrl);

        socket.on('connect', () => {
            console.log('Connected to CoinFlip Arena');
            setConnected(true);
            socket.emit('join_check');
        });

        socket.on('gameState', (state) => {
            setGameState(state);

            // Check if we have a bet in this round
            if (user) {
                const myExistingBet = state.bets.find(b => b.userId === user.id);
                setMyBet(myExistingBet || null);
            }
        });

        socket.on('betConfirmed', ({ amount, side }) => {
            refreshUser();
        });

        socket.on('error', ({ message }) => {
            alert(message);
        });

        return () => {
            socket.disconnect();
        };
    }, [user, refreshUser]);

    const handlePlaceBet = (side) => {
        if (!connected || !gameState || gameState.status !== 'betting') return;
        if (myBet) { // Prevent multiple bets for MVP simplicity or allow? Backend allows.
            // We can allow adding to bet, but let's stick to one bet per round for clean UI
            // alert("You already have a bet!");
            // Actually backend allows push.
        }

        socket.emit('placeBet', {
            userId: user.id,
            username: user.username,
            amount: parseInt(betAmount),
            side
        });
    };

    if (!gameState) return <div className="text-center text-white mt-5">Loading Arena...</div>;

    return (
        <div className="container py-4">
            <h2 className="display-4 text-white mb-4 fw-bold text-center">🪙 Coin Flip Arena</h2>

            <div className="row g-4">
                {/* HEADS Side */}
                <div className="col-md-3">
                    <div className="card p-3 h-100 border-success">
                        <h3 className="text-success text-center">HEADS</h3>
                        <div className="text-center display-6 mb-3">
                            <div className="avatar-circle mx-auto mb-2" style={{ width: 60, height: 60, background: '#00e701', border: 'none' }}>H</div>
                        </div>
                        <div className="text-center mb-3">
                            <span className="badge bg-success fs-5">Pool: ${gameState.stats.heads}</span>
                        </div>
                        <div className="list-group list-group-flush" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            {gameState.bets.filter(b => b.side === 'heads').map((bet, i) => (
                                <div key={i} className="list-group-item bg-transparent text-white d-flex justify-content-between">
                                    <span>{bet.username}</span>
                                    <span className="text-success fw-bold">${bet.amount}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* CENTER: Coin & Controls */}
                <div className="col-md-6 text-center">
                    {/* Timer / Status */}
                    <div className="mb-4">
                        {gameState.status === 'betting' && (
                            <div className="display-1 fw-bold text-warning">{gameState.timeLeft}s</div>
                        )}
                        {gameState.status === 'flipping' && (
                            <div className="display-4 fw-bold text-info">FLIPPING...</div>
                        )}
                        {gameState.status === 'result' && (
                            <div className="display-4 fw-bold text-white">
                                {gameState.outcome ? gameState.outcome.toUpperCase() : ''} WINS!
                            </div>
                        )}
                        <p className="text-muted text-uppercase letter-spacing-2">{gameState.status} PHASE</p>
                    </div>

                    {/* The Coin */}
                    <div className="coin-container mx-auto mb-5" style={{ height: '200px', width: '200px' }}>
                        <div className={`coin ${gameState.status === 'flipping' ? 'flipping' : ''} ${gameState.status === 'result' ? gameState.outcome : ''}`}>
                            <div className="side-a"></div>
                            <div className="side-b"></div>
                        </div>
                    </div>

                    {/* Betting Controls */}
                    <div className="card p-4 mx-auto" style={{ maxWidth: '400px' }}>
                        {gameState.status === 'betting' ? (
                            <>
                                <label className="text-muted mb-2">My Wallet: ${user?.cash?.toFixed(2)}</label>
                                <div className="input-group mb-3">
                                    <span className="input-group-text bg-dark text-white border-secondary">$</span>
                                    <input
                                        type="number"
                                        className="form-control bg-dark text-white border-secondary text-center fw-bold fs-4"
                                        value={betAmount}
                                        onChange={e => setBetAmount(e.target.value)}
                                        min="1"
                                    />
                                </div>
                                <div className="d-flex gap-2">
                                    <button
                                        className="btn btn-success flex-grow-1 py-3 fw-bold fs-5"
                                        onClick={() => handlePlaceBet('heads')}
                                    >
                                        BET HEADS
                                    </button>
                                    <button
                                        className="btn btn-light flex-grow-1 py-3 fw-bold fs-5"
                                        onClick={() => handlePlaceBet('tails')}
                                    >
                                        BET TAILS
                                    </button>
                                </div>
                                {myBet && (
                                    <div className="mt-3 text-info">
                                        You bet ${myBet.amount} on {myBet.side.toUpperCase()}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="text-muted py-3">
                                Betting closed. <br /> Good luck!
                            </div>
                        )}
                    </div>

                    {/* History */}
                    <div className="mt-5">
                        <p className="text-muted mb-2">Recent Outcomes</p>
                        <div className="d-flex justify-content-center gap-2">
                            {gameState.history.map((res, i) => (
                                <div
                                    key={i}
                                    className={`badge rounded-circle p-2 ${res === 'heads' ? 'bg-success' : 'bg-light text-dark'}`}
                                    style={{ width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                    {res.charAt(0).toUpperCase()}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* TAILS Side */}
                <div className="col-md-3">
                    <div className="card p-3 h-100 border-light">
                        <h3 className="text-white text-center">TAILS</h3>
                        <div className="text-center display-6 mb-3">
                            <div className="avatar-circle mx-auto mb-2" style={{ width: 60, height: 60, background: '#e0e0e0', color: '#333', border: 'none' }}>T</div>
                        </div>
                        <div className="text-center mb-3">
                            <span className="badge bg-secondary fs-5">Pool: ${gameState.stats.tails}</span>
                        </div>
                        <div className="list-group list-group-flush" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                            {gameState.bets.filter(b => b.side === 'tails').map((bet, i) => (
                                <div key={i} className="list-group-item bg-transparent text-white d-flex justify-content-between">
                                    <span>{bet.username}</span>
                                    <span className="text-white fw-bold">${bet.amount}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Chat Section */}
            <div className="row mt-4">
                <div className="col-md-6 mx-auto">
                    <Chat socket={socket} username={user.username} />
                </div>
            </div>
        </div>
    );
};

export default CoinFlipLobby;
