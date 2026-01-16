import React, { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { supabase } from '../services/supabase';
import './Leaderboard.css';

const Leaderboard = () => {
    const { user } = useContext(AuthContext);
    const [leaders, setLeaders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userRank, setUserRank] = useState(null);

    useEffect(() => {
        fetchLeaderboard();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchLeaderboard = async () => {
        try {
            setLoading(true);

            // Fetch top 50 users ordered by cash
            const { data, error } = await supabase
                .from('users')
                .select('id, username, avatar, cash, stats')
                .eq('is_active', true)
                .order('cash', { ascending: false })
                .limit(50);

            if (error) throw error;

            // Add rank to each user
            const rankedData = data.map((u, index) => ({
                ...u,
                rank: index + 1,
                wins: u.stats?.wins || 0
            }));

            setLeaders(rankedData);

            // Find current user's rank
            if (user?.id) {
                const userIndex = rankedData.findIndex(u => u.id === user.id);
                if (userIndex !== -1) {
                    setUserRank(userIndex + 1);
                }
            }
        } catch (error) {
            console.error('Error fetching leaderboard:', error);
        } finally {
            setLoading(false);
        }
    };

    const formatCash = (amount) => {
        if (amount >= 1000000) {
            return `$${(amount / 1000000).toFixed(2)}M`;
        } else if (amount >= 1000) {
            return `$${(amount / 1000).toFixed(1)}K`;
        }
        return `$${amount.toFixed(2)}`;
    };

    const getInitials = (username) => {
        return username ? username.substring(0, 2).toUpperCase() : '??';
    };

    const getRankIcon = (rank) => {
        switch (rank) {
            case 1: return '🥇';
            case 2: return '🥈';
            case 3: return '🥉';
            default: return null;
        }
    };

    return (
        <div className="leaderboard-wrapper">
            <div className="leaderboard-container">
                <div className="leaderboard-header">
                    <h1>🏆 Leaderboard</h1>
                    <p className="leaderboard-subtitle">Top 50 Players by Balance</p>
                </div>

                {userRank && (
                    <div className="user-rank-card">
                        <span className="your-rank-label">Your Rank</span>
                        <span className="your-rank-value">#{userRank}</span>
                    </div>
                )}

                {loading ? (
                    <div className="loading-state">Loading leaderboard...</div>
                ) : (
                    <div className="leaderboard-table">
                        <div className="table-header">
                            <span className="col-rank">Rank</span>
                            <span className="col-player">Player</span>
                            <span className="col-balance">Balance</span>
                            <span className="col-wins">Wins</span>
                        </div>
                        <div className="table-body">
                            {leaders.map((leader) => (
                                <div
                                    key={leader.id}
                                    className={`table-row ${leader.id === user?.id ? 'current-user' : ''} ${leader.rank <= 3 ? 'top-three' : ''}`}
                                >
                                    <span className="col-rank">
                                        {getRankIcon(leader.rank) || `#${leader.rank}`}
                                    </span>
                                    <span className="col-player">
                                        <div className={`player-avatar rank-${leader.rank}`}>
                                            {getInitials(leader.username)}
                                        </div>
                                        <span className="player-name">
                                            {leader.username}
                                            {leader.id === user?.id && <span className="you-badge">YOU</span>}
                                        </span>
                                    </span>
                                    <span className="col-balance">{formatCash(leader.cash)}</span>
                                    <span className="col-wins">{leader.wins}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Leaderboard;
