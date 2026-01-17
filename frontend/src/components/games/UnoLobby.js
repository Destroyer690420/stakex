import React, { useState, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import toast from 'react-hot-toast';
import './Uno.css';

const UnoLobby = () => {
    const navigate = useNavigate();
    const { user, refreshUser } = useContext(AuthContext);

    const [rooms, setRooms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [betAmount, setBetAmount] = useState(50);
    const [maxPlayers, setMaxPlayers] = useState(4);
    const [creating, setCreating] = useState(false);
    const [joining, setJoining] = useState(null);

    // Fetch available rooms
    const fetchRooms = useCallback(async () => {
        try {
            const { data, error } = await supabase.rpc('fn_get_uno_rooms');

            if (error) throw error;
            if (data?.success) {
                setRooms(data.rooms || []);
            }
        } catch (err) {
            console.error('Error fetching rooms:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch and subscribe to changes
    useEffect(() => {
        fetchRooms();

        // Subscribe to room changes
        const subscription = supabase
            .channel('uno-lobby')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'uno_rooms'
            }, () => {
                fetchRooms();
            })
            .subscribe();

        // Poll every 5 seconds as backup
        const interval = setInterval(fetchRooms, 5000);

        return () => {
            subscription.unsubscribe();
            clearInterval(interval);
        };
    }, [fetchRooms]);

    // Create a new room
    const handleCreateRoom = async () => {
        if (betAmount < 10) {
            toast.error('Minimum bet is $10');
            return;
        }

        if (betAmount > user?.cash) {
            toast.error('Insufficient balance');
            return;
        }

        setCreating(true);
        try {
            const { data, error } = await supabase.rpc('fn_create_uno_room', {
                p_user_id: user.id,
                p_bet_amount: betAmount,
                p_max_players: maxPlayers
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Room created!');
            navigate(`/games/uno/${data.roomId}`);

        } catch (err) {
            toast.error(err.message);
        } finally {
            setCreating(false);
        }
    };

    // Join an existing room
    const handleJoinRoom = async (roomId) => {
        setJoining(roomId);
        try {
            const { data, error } = await supabase.rpc('fn_join_uno_room', {
                p_user_id: user.id,
                p_room_id: roomId
            });

            if (error) throw error;
            if (!data.success) throw new Error(data.error);

            refreshUser();
            toast.success('Joined room!');
            navigate(`/games/uno/${roomId}`);

        } catch (err) {
            toast.error(err.message);
        } finally {
            setJoining(null);
        }
    };

    // Quick bet amount buttons
    const quickBets = [10, 25, 50, 100, 250, 500];
    const playerOptions = [2, 3, 4];

    return (
        <div className="uno-lobby-wrapper">
            <div className="uno-lobby-container">
                {/* Create Room Button - Top */}
                <div style={{ display: 'flex', justifyContent: 'center', margin: '40px 0' }}>
                    <button
                        className="uno-create-btn"
                        onClick={() => setShowCreateModal(true)}
                        style={{ margin: 0 }}
                    >
                        <span>+</span> Create Room
                    </button>
                </div>

                {/* Room List */}
                <div className="uno-room-list">
                    <h2 className="uno-section-title">Available Rooms</h2>

                    {loading ? (
                        <div className="uno-loading">
                            <div className="uno-loading-spinner"></div>
                            <div className="uno-loading-text">Loading rooms...</div>
                        </div>
                    ) : rooms.length === 0 ? (
                        <div className="uno-empty-state">
                            <div className="uno-empty-icon">🎴</div>
                            <div className="uno-empty-text">No rooms available</div>
                            <div className="uno-empty-subtext">Create a room to start playing!</div>
                        </div>
                    ) : (
                        <div className="uno-rooms-grid">
                            {rooms.map((room) => (
                                <motion.div
                                    key={room.id}
                                    className="uno-room-card"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    whileHover={{ scale: 1.02 }}
                                >
                                    <div className="room-header">
                                        <div className="room-host">
                                            <div className="host-avatar">
                                                {room.host_username?.charAt(0).toUpperCase() || '?'}
                                            </div>
                                            <div className="host-info">
                                                <span className="host-name">{room.host_username || 'Unknown'}</span>
                                                <span className="host-badge">👑 Host</span>
                                            </div>
                                        </div>
                                        <div className="room-players">
                                            <span className="player-count">{room.player_count}/{room.max_players}</span>
                                            <span className="player-label">Players</span>
                                        </div>
                                    </div>

                                    <div className="room-pot">
                                        <div className="pot-label">Prize Pool</div>
                                        <div className="pot-amount">${Number(room.pot_amount).toLocaleString()}</div>
                                    </div>

                                    <div className="room-entry">
                                        <span className="entry-label">Entry Fee</span>
                                        <span className="entry-amount">${Number(room.bet_amount).toLocaleString()}</span>
                                    </div>

                                    <button
                                        className={`room-join-btn ${room.player_count >= room.max_players ? 'full' : ''}`}
                                        onClick={() => handleJoinRoom(room.id)}
                                        disabled={joining === room.id || room.player_count >= room.max_players}
                                    >
                                        {joining === room.id ? 'Joining...' :
                                            room.player_count >= room.max_players ? 'Full' : 'Join Game'}
                                    </button>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Stats Bar - Footer */}
                <div className="uno-lobby-stats" style={{ marginTop: 'auto', paddingTop: '40px' }}>
                    <div className="stat-item">
                        <span className="stat-value">{rooms.length}</span>
                        <span className="stat-label">Active Rooms</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">
                            ${rooms.reduce((sum, r) => sum + Number(r.pot_amount || 0), 0).toLocaleString()}
                        </span>
                        <span className="stat-label">Total Pots</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">
                            {rooms.reduce((sum, r) => sum + (r.player_count || 0), 0)}
                        </span>
                        <span className="stat-label">Players</span>
                    </div>
                </div>
            </div>

            {/* Create Room Modal */}
            <AnimatePresence>
                {showCreateModal && (
                    <motion.div
                        className="uno-modal-overlay"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowCreateModal(false)}
                    >
                        <motion.div
                            className="uno-modal"
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Close Button Only */}
                            <button
                                className="modal-close-icon"
                                onClick={() => setShowCreateModal(false)}
                                style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', color: '#666', fontSize: '1.2rem', cursor: 'pointer', zIndex: 10 }}
                            >
                                ✕
                            </button>

                            <div className="uno-modal-body">
                                {/* Player Count Selection */}
                                <div className="player-count-group">
                                    <label>Number of Players</label>
                                    <div className="player-count-options">
                                        {playerOptions.map((count) => (
                                            <button
                                                key={count}
                                                className={`player-count-btn ${maxPlayers === count ? 'active' : ''}`}
                                                onClick={() => setMaxPlayers(count)}
                                            >
                                                <span className="player-count-num">{count}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="bet-input-group">
                                    <label>Entry Fee (Bet Amount)</label>
                                    <div className="bet-input-wrapper">
                                        <span className="bet-currency">$</span>
                                        <input
                                            type="number"
                                            value={betAmount}
                                            onChange={(e) => setBetAmount(Number(e.target.value))}
                                            min={10}
                                            max={10000}
                                        />
                                    </div>
                                    <span className="balance-hint">
                                        Balance: ${user?.cash?.toLocaleString() || 0}
                                    </span>
                                </div>

                                <div className="quick-bets">
                                    {quickBets.map((amount) => (
                                        <button
                                            key={amount}
                                            className={`quick-bet-btn ${betAmount === amount ? 'active' : ''}`}
                                            onClick={() => setBetAmount(amount)}
                                        >
                                            ${amount}
                                        </button>
                                    ))}
                                </div>

                                <div className="pot-preview">
                                    <div className="pot-preview-label">Starting Pot</div>
                                    <div className="pot-preview-amount">${betAmount.toLocaleString()}</div>
                                    <div className="pot-preview-hint">
                                        Max Prize: ${(betAmount * maxPlayers).toLocaleString()} ({maxPlayers} players)
                                    </div>
                                </div>
                            </div>

                            <div className="uno-modal-footer">
                                <button
                                    className="modal-cancel"
                                    onClick={() => setShowCreateModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="modal-create"
                                    onClick={handleCreateRoom}
                                    disabled={creating || betAmount < 10 || betAmount > (user?.cash || 0)}
                                >
                                    {creating ? 'Creating...' : `Create Room (-$${betAmount})`}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default UnoLobby;
