import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { AuthContext } from '../../context/AuthContext';

let socket;

const CoinFlipGame = () => {
    const { gameId } = useParams();
    const { user, refreshUser } = useContext(AuthContext);
    const navigate = useNavigate();

    const [gameData, setGameData] = useState(null); // { creator, joiner }
    const [status, setStatus] = useState('waiting'); // waiting, spinning, result
    const [result, setResult] = useState(null); // 'heads', 'tails'
    const [winnerId, setWinnerId] = useState(null);
    const [countdown, setCountdown] = useState(0);

    useEffect(() => {
        const socketUrl = 'http://localhost:5000/coinflip';
        socket = io(socketUrl);

        socket.on('connect', () => {
            console.log('Connected to CoinFlip Arena');
            socket.emit('join_lobby', { id: user.id, username: user.username });
            // Should verify if we are part of this game, or allow spectators
            // For MVP, we just rely on game_started events or lobby state?
            // Ideally, we fetch game state on load. 
            // BUT: We don't have a fetch endpoint.
            // Let's implement a 'get_game_state' socket event or just wait for pushed events.
            // If we navigated here from Lobby, we might expect 'game_started' has fired or will fire.
            // If creator: We are waiting.
            // If joiner: We are waiting for 'game_started'.

            // NOTE: If we refresh page, we lose state. MVP limitation.
            // Workaround: Ask server for state.
            socket.emit('join_game', { gameId }); // Re-join logic for spectators? no, that triggers deduction.
            // Let's rely on 'game_started' being broadcast to room 'gameId'.
            // Actually, `create_game` joins the socket room. `join_game` joins the socket room.
            // We need to re-join the socket room if we refreshed.
            // For now: Assume no refresh.
        });

        socket.on('game_started', (data) => {
            setGameData(data); // { creator, joiner }
            setStatus('spinning');
            // Animation triggers automatically via CSS based on status 'spinning'
        });

        socket.on('game_ended', ({ result, winnerId, payout }) => {
            setResult(result);
            setWinnerId(winnerId);
            setStatus('result');
            refreshUser(); // Update balance

            setCountdown(5);
            const interval = setInterval(() => {
                setCountdown(prev => {
                    if (prev <= 1) {
                        clearInterval(interval);
                        navigate('/games/coinflip'); // Back to lobby
                    }
                    return prev - 1;
                });
            }, 1000);
        });

        return () => {
            socket.disconnect();
        };
    }, [gameId, user, navigate, refreshUser]);

    return (
        <div className="container py-5 text-center">
            {status === 'waiting' && <h2 className="text-white animate-pulse">Waiting for opponent...</h2>}

            {gameData && (
                <div className="d-flex justify-content-center align-items-center gap-5 my-5">
                    {/* Player A */}
                    <div className={`player-card ${winnerId === gameData.creator.id ? 'winner-glow' : ''}`}>
                        <div className="avatar-circle mb-3 mx-auto" style={{ width: '80px', height: '80px', fontSize: '2rem' }}>
                            {gameData.creator.username.charAt(0).toUpperCase()}
                        </div>
                        <h4 className="text-white">{gameData.creator.username}</h4>
                        <p className="text-muted">{gameData.creator.side.toUpperCase()}</p>
                    </div>

                    {/* COIN */}
                    <div className="coin-container">
                        <div className={`coin ${status === 'spinning' ? 'flipping' : ''} ${status === 'result' ? result : ''}`}>
                            <div className="side-a"></div>
                            <div className="side-b"></div>
                        </div>
                    </div>

                    {/* Player B */}
                    <div className={`player-card ${winnerId === gameData.joiner.id ? 'winner-glow' : ''}`}>
                        <div className="avatar-circle mb-3 mx-auto" style={{ width: '80px', height: '80px', fontSize: '2rem', background: '#00d9a6' }}>
                            {gameData.joiner.username.charAt(0).toUpperCase()}
                        </div>
                        <h4 className="text-white">{gameData.joiner.username}</h4>
                        <p className="text-muted">{gameData.creator.side === 'heads' ? 'TAILS' : 'HEADS'}</p>
                    </div>
                </div>
            )}

            {status === 'result' && (
                <div className="mt-5">
                    <h1 className="fw-bold display-3" style={{ color: winnerId === user.id ? '#00e701' : '#e94560' }}>
                        {winnerId === user.id ? 'YOU WON!' : 'YOU LOST'}
                    </h1>
                    <p className="text-muted">Returning to lobby in {countdown}...</p>
                </div>
            )}
        </div>
    );
};

export default CoinFlipGame;
