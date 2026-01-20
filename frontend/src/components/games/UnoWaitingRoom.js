import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './UnoWaitingRoom.css';
import toast from 'react-hot-toast';

const UnoWaitingRoom = ({
    room,
    players,
    onStart,
    onLeave,
    onDelete,
    onToggleReady,
    isHost,
    myPlayer
}) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const allPlayersReady = players.length >= 2 &&
        players.every(p => p.is_ready || p.user_id === room?.host_id);

    return (
        <div className="uno-waiting-wrapper">
            <div className="uno-waiting-card">
                <div className="uno-waiting-header">
                    <div className="waiting-pulse"></div>
                    <h1>WAITING ROOM</h1>
                </div>

                {/* Prize Pool Display */}
                <div className="waiting-prize-section">
                    <div className="prize-label">PRIZE POOL</div>
                    <div className="prize-value">${Number(room.pot_amount || 0).toLocaleString()}</div>
                    <div className="entry-fee-tag">
                        Entry: ${Number(room.bet_amount || 0).toLocaleString()}
                    </div>
                </div>

                {/* Players List */}
                <div className="waiting-players-container">
                    <div className="players-list-scroll">
                        <AnimatePresence>
                            {players.map((player) => (
                                <motion.div
                                    key={player.id}
                                    className={`waiting-player-row ${player.user_id === room.host_id ? 'is-host' : ''} ${player.user_id === myPlayer?.user_id ? 'is-me' : ''}`}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20 }}
                                >
                                    <div className="player-avatar-circle">
                                        {player.username.charAt(0).toUpperCase()}
                                        {player.user_id === room.host_id && <div className="host-icon-badge">👑</div>}
                                    </div>

                                    <div className="player-info-col">
                                        <div className="player-name-text">
                                            {player.username}
                                            {player.user_id === myPlayer?.user_id && <span className="me-badge">(You)</span>}
                                        </div>
                                        <div className="player-status-text">
                                            {player.user_id === room.host_id ? (
                                                <span className="status-host">HOST</span>
                                            ) : (
                                                <span className={player.is_ready ? "status-ready" : "status-waiting"}>
                                                    {player.is_ready ? "READY" : "NOT READY"}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div className="player-status-icon">
                                        {player.has_paid && <div className="paid-chip" title="Entry Fee Paid">💰</div>}
                                        {player.user_id === room.host_id ? (
                                            <div className="ready-indicator host">👑 Host</div>
                                        ) : (
                                            <div className={`ready-indicator ${player.is_ready ? 'ready' : 'not-ready'}`}>
                                                {player.is_ready ? '✓ Ready' : '⏳ Waiting'}
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>

                        {/* Empty Slots */}
                        {Array.from({ length: Math.max(0, room.max_players - players.length) }).map((_, i) => (
                            <div key={`empty-${i}`} className="waiting-player-row empty">
                                <div className="player-avatar-circle empty">?</div>
                                <div className="player-info-col">
                                    <div className="player-name-text empty">Waiting for player...</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer Controls */}
                <div className="waiting-controls">
                    {/* Host Controls */}
                    {isHost ? (
                        <div className="host-controls">
                            <motion.button
                                className="action-btn start-btn"
                                onClick={onStart}
                                disabled={!allPlayersReady || players.length < 2}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                {players.length < 2 ? 'NEED 2+ PLAYERS' : !allPlayersReady ? 'WAITING FOR READY...' : 'START GAME'}
                            </motion.button>

                            <div className="host-secondary-actions">
                                <button className="action-btn-text text-danger" onClick={() => setShowDeleteConfirm(true)}>
                                    Delete Room
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Player Controls */
                        <div className="player-controls">
                            <motion.button
                                className={`action-btn ready-toggle-btn ${myPlayer?.is_ready ? 'is-ready' : ''}`}
                                onClick={onToggleReady}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                {myPlayer?.is_ready ? 'CANCEL READY' : 'I AM READY'}
                            </motion.button>
                            <button className="action-btn-text text-danger" onClick={onLeave}>
                                Leave Room
                            </button>
                        </div>
                    )}
                </div>

                {/* Delete Confirmation Modal */}
                <AnimatePresence>
                    {showDeleteConfirm && (
                        <motion.div
                            className="delete-confirm-overlay"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                        >
                            <motion.div
                                className="delete-confirm-modal"
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0.9, opacity: 0 }}
                            >
                                <h3>Delete Room?</h3>
                                <p>This will kick all players and refund their bets.</p>
                                <div className="modal-actions">
                                    <button className="btn-cancel" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                                    <button className="btn-confirm-delete" onClick={onDelete}>Delete & Refund</button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
};

export default UnoWaitingRoom;
