import React, { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import api from '../services/api';
import ProfileComponent from '../components/Profile';

const Dashboard = () => {
    const { user, refreshUser } = useContext(AuthContext);
    const [bonusStatus, setBonusStatus] = useState(null);
    const [claimingBonus, setClaimingBonus] = useState(false);
    const [message, setMessage] = useState('');

    useEffect(() => {
        checkBonusStatus();
    }, []);

    const checkBonusStatus = async () => {
        try {
            const response = await api.get('/wallet/bonusstatus');
            setBonusStatus(response.data);
        } catch (error) {
            console.error('Failed to check bonus status:', error);
        }
    };

    const claimBonus = async () => {
        setClaimingBonus(true);
        setMessage('');
        try {
            const response = await api.get('/wallet/claimbonus');
            setMessage(response.data.message);
            setBonusStatus({ ...bonusStatus, canClaim: false });
            await refreshUser();
        } catch (error) {
            setMessage(error.response?.data?.message || 'Failed to claim bonus');
        } finally {
            setClaimingBonus(false);
        }
    };

    return (
        <div className="container py-4">
            {/* Welcome Banner */}
            <div className="text-center mb-4">
                <h1 className="display-5 fw-bold text-white">
                    Welcome back, <span style={{ color: '#ffd700' }}>{user?.username}</span>!
                </h1>
                <p className="text-muted">Ready to try your luck?</p>
            </div>

            {/* Profile Section (Compact Mode) */}
            <div className="mb-5">
                <ProfileComponent showTransactions={false} compact={true} />
            </div>

            {/* Daily Bonus Card */}
            {bonusStatus?.canClaim && (
                <div className="card mb-4 border-warning" style={{ borderWidth: '2px' }}>
                    <div className="card-body text-center py-4">
                        <h4 className="mb-3">🎁 Daily Bonus Available!</h4>
                        <p className="mb-3">Claim your free ${bonusStatus?.bonusAmount} daily bonus</p>
                        <button
                            className="btn btn-warning btn-lg"
                            onClick={claimBonus}
                            disabled={claimingBonus}
                        >
                            {claimingBonus ? 'Claiming...' : 'Claim Bonus'}
                        </button>
                    </div>
                </div>
            )}

            {message && (
                <div className="alert alert-success text-center mb-4" role="alert">
                    {message}
                </div>
            )}

            {/* Games Grid */}
            <h3 className="text-white mb-3">🎮 Play Games</h3>
            <div className="row">
                <div className="col-md-4 mb-4">
                    <Link to="/games/slots" className="text-decoration-none">
                        <div className="game-card">
                            <div className="game-icon">🎰</div>
                            <h4 className="text-white">Slots</h4>
                            <p className="text-muted mb-0">Spin to win! Match symbols for big payouts.</p>
                            <div className="mt-3">
                                <span className="badge bg-success">Min Bet: $10</span>
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="col-md-4 mb-4">
                    <Link to="/games/poker" className="text-decoration-none">
                        <div className="game-card">
                            <div className="game-icon">🃏</div>
                            <h4 className="text-white">Poker</h4>
                            <p className="text-muted mb-0">Texas Hold'em with real players.</p>
                            <div className="mt-3">
                                <span className="badge bg-warning text-dark">Multiplayer</span>
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="col-md-4 mb-4">
                    <Link to="/games/coinflip" className="text-decoration-none">
                        <div className="game-card">
                            <div className="game-icon">🪙</div>
                            <h4 className="text-white">Coin Flip</h4>
                            <p className="text-muted mb-0">PvP Heads or Tails. Double or nothing.</p>
                            <div className="mt-3">
                                <span className="badge bg-danger">PvP</span>
                            </div>
                        </div>
                    </Link>
                </div>

                <div className="col-md-4 mb-4">
                    <div className="game-card" style={{ opacity: 0.5 }}>
                        <div className="game-icon">🎡</div>
                        <h4 className="text-white">Roulette</h4>
                        <p className="text-muted mb-0">Classic casino roulette.</p>
                        <div className="mt-3">
                            <span className="badge bg-secondary">Coming Soon</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Stats Row */}
            <div className="row mb-4">
                <div className="col-md-4">
                    <div className="stat-card">
                        <div className="stat-value">{user?.stats?.gamesPlayed || 0}</div>
                        <div className="stat-label">Games Played</div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="stat-card">
                        <div className="stat-value text-success">{user?.stats?.wins || 0}</div>
                        <div className="stat-label">Wins</div>
                    </div>
                </div>
                <div className="col-md-4">
                    <div className="stat-card">
                        <div className="stat-value text-muted">${user?.stats?.biggestWin || 0}</div>
                        <div className="stat-label">Biggest Win</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dashboard;
