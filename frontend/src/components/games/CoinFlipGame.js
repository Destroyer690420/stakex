import React, { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import toast, { Toaster } from 'react-hot-toast';
import './CoinFlip.css';

const CoinFlipGame = () => {
    const { gameId } = useParams();
    const { user, refreshUser } = useContext(AuthContext);
    const navigate = useNavigate();

    const [room, setRoom] = useState(null);
    const [loading, setLoading] = useState(true);
    const [coinState, setCoinState] = useState('idle');
    const [battleResult, setBattleResult] = useState(null);

    // Fetch room data
    useEffect(() => {
        if (!gameId) {
            navigate('/games/coinflip');
            return;
        }

        fetchRoom();

        // Subscribe to room updates
        const channel = supabase
            .channel(`coinflip_room_${gameId}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'coinflip_rooms',
                    filter: `id=eq.${gameId}`
                },
                (payload) => {
                    handleRoomUpdate(payload.new);
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [gameId]);

    const fetchRoom = async () => {
        try {
            const { data, error } = await supabase
                .from('coinflip_rooms')
                .select('*')
                .eq('id', gameId)
                .single();

            if (error) throw error;

            setRoom(data);

            // If game is already finished, show result
            if (data.status === 'finished') {
                setCoinState(`result-${data.flip_result}`);
                setBattleResult({
                    flipResult: data.flip_result,
                    winnerId: data.winner_id,
                    isWinner: data.winner_id === user.id
                });
            } else if (data.status === 'playing') {
                // Game in progress - animate
                setCoinState('spinning');
            }
        } catch (error) {
            console.error('Error fetching room:', error);
            toast.error('Game not found');
            navigate('/games/coinflip');
        } finally {
            setLoading(false);
        }
    };

    const handleRoomUpdate = (updatedRoom) => {
        setRoom(updatedRoom);

        if (updatedRoom.status === 'playing' && coinState === 'idle') {
            setCoinState('spinning');
        }

        if (updatedRoom.status === 'finished' && !battleResult) {
            // Animate coin landing
            setTimeout(() => {
                setCoinState(`result-${updatedRoom.flip_result}`);

                setTimeout(() => {
                    setBattleResult({
                        flipResult: updatedRoom.flip_result,
                        winnerId: updatedRoom.winner_id,
                        isWinner: updatedRoom.winner_id === user.id
                    });
                    refreshUser();
                }, 1000);
            }, 500);
        }
    };

    if (loading) {
        return (
            <div className="coinflip-wrapper">
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <div>Loading battle...</div>
                </div>
            </div>
        );
    }

    if (!room) {
        return (
            <div className="coinflip-wrapper">
                <div className="empty-state">
                    <div className="empty-state-icon">❌</div>
                    <div className="empty-state-text">Game not found</div>
                    <button className="create-btn" onClick={() => navigate('/games/coinflip')}>
                        Back to Lobby
                    </button>
                </div>
            </div>
        );
    }

    const creatorSide = room.creator_side;
    const challengerSide = creatorSide === 'heads' ? 'tails' : 'heads';
    const pot = room.bet_amount * 2;

    return (
        <div className="coinflip-wrapper">
            <Toaster position="top-center" />

            <div className="battle-arena">
                <div className="battle-header">
                    <h1 className="battle-title">⚔️ BATTLE ARENA ⚔️</h1>
                    <div className="battle-pot">Total Pot: ${pot.toFixed(2)}</div>
                </div>

                <div className="players-container">
                    {/* Creator */}
                    <div className={`player-card ${battleResult ? (battleResult.winnerId === room.creator_id ? 'winner' : 'loser') : ''}`}>
                        <div className={`player-avatar ${creatorSide}`}>
                            {room.creator_username?.charAt(0).toUpperCase()}
                        </div>
                        <div className="player-name">{room.creator_username}</div>
                        <div className="player-side">{creatorSide}</div>
                    </div>

                    <div className="vs-text">VS</div>

                    {/* Challenger */}
                    <div className={`player-card ${battleResult ? (battleResult.winnerId === room.challenger_id ? 'winner' : 'loser') : ''}`}>
                        <div className={`player-avatar ${challengerSide}`}>
                            {room.challenger_username?.charAt(0).toUpperCase() || '?'}
                        </div>
                        <div className="player-name">
                            {room.challenger_username || 'Waiting...'}
                        </div>
                        <div className="player-side">{challengerSide}</div>
                    </div>
                </div>

                {/* 3D Coin */}
                <div className="coin-stage">
                    <div className={`coin-3d ${coinState}`}>
                        <div className="coin-face coin-heads">H</div>
                        <div className="coin-face coin-tails">T</div>
                    </div>
                </div>

                {/* Waiting State */}
                {room.status === 'waiting' && (
                    <div style={{ color: '#7a8599', textAlign: 'center', marginTop: '24px' }}>
                        Waiting for opponent to join...
                    </div>
                )}

                {/* Spinning State */}
                {coinState === 'spinning' && !battleResult && (
                    <div style={{ color: '#7a8599', textAlign: 'center', marginTop: '24px' }}>
                        Flipping the coin...
                    </div>
                )}

                {/* Result */}
                {battleResult && (
                    <div className={`result-display ${battleResult.isWinner ? 'won' : 'lost'}`}>
                        <div className="result-text">
                            {battleResult.isWinner ? '🎉 YOU WON!' : '😔 YOU LOST'}
                        </div>
                        {battleResult.isWinner && (
                            <div className="result-amount">
                                +${(pot * 0.99).toFixed(2)}
                            </div>
                        )}
                        <button
                            className="create-btn"
                            style={{ marginTop: '24px' }}
                            onClick={() => navigate('/games/coinflip')}
                        >
                            Back to Lobby
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CoinFlipGame;
