import React, { useState, useEffect, useContext } from 'react';
import { io } from 'socket.io-client';
import { AuthContext } from '../../context/AuthContext';
import Chat from './Chat';

let socket;

const PokerGame = () => {
    const { user, refreshUser } = useContext(AuthContext);
    const [connected, setConnected] = useState(false);
    const [gameState, setGameState] = useState(null);
    const [buyIn, setBuyIn] = useState(1000);
    const [joined, setJoined] = useState(false);
    const [roomId, setRoomId] = useState('Poker1'); // Default room
    const [raiseAmount, setRaiseAmount] = useState(0);

    useEffect(() => {
        const socketUrl = 'http://localhost:5000/poker';
        socket = io(socketUrl, {
            auth: { token: localStorage.getItem('token') } // Assuming JWT stored in localstorage
        });

        socket.on('connect', () => {
            console.log('Connected to Poker');
            setConnected(true);
        });

        socket.on('gameState', (state) => {
            setGameState(state);
        });

        socket.on('roomUpdate', (state) => {
            // Update only partials if needed, or re-use gameState
            // Our backend emits 'gameState' on update mostly, but 'roomUpdate' on join.
            // Let's assume roomUpdate structure matches partial gameState or just fetch full?
            // Backend sends: { players, pot, phase, communityCards }
            setGameState(prev => ({ ...prev, ...state }));
        });

        socket.on('handEnded', (data) => {
            // Show winner, delay, etc.
            refreshUser();
        });

        socket.on('error', ({ message }) => {
            alert(message);
        });

        return () => {
            socket.disconnect();
        };
    }, [refreshUser]);

    const handleJoin = () => {
        if (!socket) return;
        socket.emit('joinRoom', { roomId, buyInAmount: parseInt(buyIn) });
        setJoined(true);
    };

    const handleAction = (action) => {
        if (!socket) return;
        let amount = 0;
        if (action === 'raise') amount = parseInt(raiseAmount);

        socket.emit('playerAction', { action, amount });
    };

    // UI Helpers
    const getCardColor = (suit) => ['♥', '♦'].includes(suit) ? 'red' : 'black';

    if (!connected) return <div className="text-white text-center mt-5">Connecting to Poker...</div>;

    if (!joined) {
        return (
            <div className="container py-5 text-white">
                <div className="row justify-content-center">
                    <div className="col-md-6">
                        <div className="card p-4">
                            <h2 className="text-center mb-4">Join Poker Room</h2>
                            <div className="mb-3">
                                <label>Wallet Balance: ${user.cash}</label>
                            </div>
                            <div className="mb-3">
                                <label>Buy-In Amount</label>
                                <input
                                    type="number"
                                    className="form-control"
                                    value={buyIn}
                                    onChange={(e) => setBuyIn(e.target.value)}
                                />
                            </div>
                            <div className="mb-3">
                                <label>Room ID</label>
                                <input
                                    type="text"
                                    className="form-control"
                                    value={roomId}
                                    onChange={(e) => setRoomId(e.target.value)}
                                />
                            </div>
                            <button className="btn btn-success w-100" onClick={handleJoin}>Sit Down</button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid py-4" style={{ minHeight: '80vh' }}>
            <div className="row">
                <div className="col-md-9">
                    {/* POKER TABLE */}
                    <div className="poker-table-container position-relative bg-success rounded-pill mx-auto mb-4"
                        style={{ height: '500px', width: '90%', border: '15px solid #5a3d2b', boxShadow: 'inset 0 0 50px rgba(0,0,0,0.5)' }}>

                        {/* Community Cards */}
                        <div className="position-absolute top-50 start-50 translate-middle text-center">
                            <div className="mb-2 text-warning fw-bold fs-4">Pot: ${gameState?.pot || 0}</div>
                            <div className="d-flex gap-2 justify-content-center">
                                {gameState?.communityCards?.map((card, i) => (
                                    <div key={i} className="card-display bg-white rounded p-2 text-center" style={{ width: 50, height: 70 }}>
                                        <div style={{ color: getCardColor(card.suit), fontSize: '1.2rem' }}>{card.value}</div>
                                        <div style={{ color: getCardColor(card.suit), fontSize: '1.5rem' }}>{card.suit}</div>
                                    </div>
                                ))}
                                {(!gameState?.communityCards || gameState.communityCards.length === 0) && (
                                    <div className="text-white-50 fst-italic">Dealing...</div>
                                )}
                            </div>
                        </div>

                        {/* Players */}
                        {gameState?.players?.map((player, i) => {
                            // Calculate position based on seat index (simple map for max 6 players)
                            const positions = [
                                { bottom: '10%', left: '50%', transform: 'centerX(-50%)' },
                                { bottom: '30%', left: '10%' },
                                { top: '30%', left: '10%' },
                                { top: '10%', left: '50%', transform: 'centerX(-50%)' },
                                { top: '30%', right: '10%' },
                                { bottom: '30%', right: '10%' }
                            ];
                            // This positioning logic is naive, needs relative to ME at bottom.
                            // For MVP, just absolute positions by index.
                            const pos = positions[i % 6];
                            const isMe = player.username === user.username;
                            const isTurn = i === gameState.turnIndex;

                            return (
                                <div key={i} className="position-absolute text-center bg-dark p-2 rounded border border-secondary"
                                    style={{ ...pos, width: 120, zIndex: 10, borderColor: isTurn ? '#ffff00 !important' : '' }}>
                                    <div className="avatar mb-1">
                                        <div className="bg-secondary rounded-circle d-inline-block text-white fw-bold" style={{ width: 30, height: 30, lineHeight: '30px' }}>
                                            {player.username.charAt(0)}
                                        </div>
                                    </div>
                                    <div className="text-white small text-truncate">{player.username}</div>
                                    <div className="text-warning small">${player.chips}</div>
                                    {player.bet > 0 && <div className="badge bg-light text-dark mt-1">${player.bet}</div>}
                                    {player.folded && <div className="badge bg-danger mt-1">FOLD</div>}

                                    {/* Hand */}
                                    <div className="d-flex justify-content-center gap-1 mt-1">
                                        {player.hand ? player.hand.map((c, ci) => (
                                            <div key={ci} className="bg-white rounded p-1" style={{ width: 25, height: 35, fontSize: '0.8rem' }}>
                                                <span style={{ color: getCardColor(c.suit) }}>{c.value}{c.suit}</span>
                                            </div>
                                        )) : (
                                            /* Back of cards */
                                            <>
                                                <div className="bg-primary rounded" style={{ width: 25, height: 35 }}></div>
                                                <div className="bg-primary rounded" style={{ width: 25, height: 35 }}></div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Controls */}
                    <div className="d-flex justify-content-center gap-3">
                        <button className="btn btn-danger btn-lg" onClick={() => handleAction('fold')}>Fold</button>
                        <button className="btn btn-secondary btn-lg" onClick={() => handleAction('check')}>Check</button>
                        <button className="btn btn-primary btn-lg" onClick={() => handleAction('call')}>Call</button>
                        <div className="input-group" style={{ width: 200 }}>
                            <input type="number" className="form-control" value={raiseAmount} onChange={(e) => setRaiseAmount(e.target.value)} placeholder="Amount" />
                            <button className="btn btn-warning" onClick={() => handleAction('raise')}>Raise</button>
                        </div>
                    </div>
                </div>

                {/* Sidebar / Chat */}
                <div className="col-md-3">
                    <Chat socket={socket} username={user.username} />
                </div>
            </div>
        </div>
    );
};

export default PokerGame;
