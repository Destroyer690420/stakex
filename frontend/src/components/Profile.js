import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';

const Profile = ({ showTransactions = true, compact = false }) => {
    const { user, refreshUser } = useContext(AuthContext);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showTopUp, setShowTopUp] = useState(false);
    const [topUpAmount, setTopUpAmount] = useState(100);
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (showTransactions) {
            fetchTransactions();
        } else {
            setLoading(false);
        }
    }, [showTransactions, user]); // Refresh if user changes (e.g. after top up)

    const fetchTransactions = async () => {
        try {
            const response = await api.get('/wallet/history?limit=10');
            setTransactions(response.data.transactions);
        } catch (error) {
            console.error('Failed to fetch transactions:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleTopUp = async () => {
        try {
            // Mock request for now URL
            // In a real app, this would probably be a POST to /wallet/deposit
            await api.post('/wallet/request-credit', { amount: topUpAmount });

            // Since the backend endpoint might not exist or just mocks it
            // We'll simulate success for UI demo if it fails or just proceed
            setMessage(`Successfully requested $${topUpAmount} credits!`);
            setShowTopUp(false);
            await refreshUser(); // Refresh balance
            fetchTransactions(); // Refresh history

            setTimeout(() => setMessage(''), 3000);

        } catch (error) {
            // Fallback for demo if endpoint doesn't exist
            console.warn("Top up API call failed, simulating success for demo", error);
            setMessage(`(DEMO) Simulating top up of $${topUpAmount}`);
            setShowTopUp(false);
            setTimeout(() => setMessage(''), 3000);
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString();
    };

    const getTypeColor = (type) => {
        if (['win', 'bonus', 'admin_grant', 'credit', 'game_win'].includes(type)) {
            return 'text-warning'; // Gold
        }
        return 'text-danger'; // Red
    };



    return (
        <div className="profile-container">
            {message && <div className="alert alert-success text-center">{message}</div>}

            <div className={`card mb-4 ${compact ? 'p-3' : 'p-4'}`}>
                <div className="d-flex justify-content-between align-items-center flex-wrap">
                    <div className="d-flex align-items-center gap-3">
                        <div className="profile-avatar">
                            {/* Placeholder Avatar */}
                            <div className="avatar-circle">
                                {user?.username?.charAt(0).toUpperCase()}
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white mb-0">{user?.username}</h3>
                            <p className="text-muted mb-0">{user?.email}</p>
                        </div>
                    </div>

                    <div className="text-end mt-3 mt-md-0">
                        <div className="text-muted small">Current Balance</div>
                        <div className="balance-display display-6 fw-bold text-warning">
                            ${user?.cash?.toLocaleString() || 0}
                        </div>
                        <button
                            className="btn btn-warning btn-sm mt-2 fw-bold"
                            onClick={() => setShowTopUp(true)}
                        >
                            Top Up Wallet
                        </button>
                    </div>
                </div>
            </div>

            {/* Top Up Modal (Simple overlay for now) */}
            {showTopUp && (
                <div className="params-modal-overlay">
                    <div className="params-modal">
                        <h4 className="text-white mb-3">Top Up Wallet</h4>
                        <p className="text-muted">Select an amount to deposit (Demo)</p>
                        <div className="d-flex gap-2 justify-content-center mb-4">
                            {[100, 500, 1000, 5000].map(amt => (
                                <button
                                    key={amt}
                                    className={`btn ${topUpAmount === amt ? 'btn-warning' : 'btn-outline-light'}`}
                                    onClick={() => setTopUpAmount(amt)}
                                >
                                    ${amt}
                                </button>
                            ))}
                        </div>
                        <div className="d-flex gap-2">
                            <button className="btn btn-primary flex-grow-1" onClick={handleTopUp}>
                                Confirm Deposit
                            </button>
                            <button className="btn btn-outline-secondary" onClick={() => setShowTopUp(false)}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showTransactions && (
                <div className="card p-4">
                    <h4 className="text-white mb-4">Recent Transactions</h4>

                    {loading ? (
                        <div className="text-center py-4">
                            <div className="spinner-border text-light" role="status"></div>
                        </div>
                    ) : transactions.length === 0 ? (
                        <p className="text-muted text-center py-4">No transactions yet.</p>
                    ) : (
                        <div className="table-responsive">
                            <table className="table table-dark table-hover">
                                <thead>
                                    <tr>
                                        <th>Type</th>
                                        <th>Description</th>
                                        <th>Amount</th>
                                        {!compact && <th>Date</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((tx) => (
                                        <tr key={tx._id}>
                                            <td><span className="text-capitalize">{tx.type.replace('_', ' ')}</span></td>
                                            <td>{tx.description}</td>
                                            <td className={getTypeColor(tx.type)}>
                                                {['win', 'bonus', 'admin_grant', 'credit', 'game_win'].includes(tx.type) ? '+' : '-'}
                                                ${tx.amount.toLocaleString()}
                                            </td>
                                            {!compact && <td className="text-muted small">{formatDate(tx.createdAt)}</td>}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default Profile;
