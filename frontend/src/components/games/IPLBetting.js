import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { io } from 'socket.io-client';
import api from '../../services/api';
import toast from 'react-hot-toast';
import './IPLBetting.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// IPL team colors for the logo circles fallback
const TEAM_COLORS = {
    MI: '#004BA0', CSK: '#FDB913', RCB: '#EC1C24', KKR: '#3B215D',
    SRH: '#FF822A', DC: '#17479E', PBKS: '#ED1B24', RR: '#EA1A85',
    LSG: '#A72056', GT: '#1B2133'
};

// IPL team logos
const TEAM_LOGOS = {
    CSK: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171030/chennai-super-kings.jpg',
    DC: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171031/delhi-capitals.jpg',
    KKR: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171032/kolkata-knight-riders.jpg',
    MI: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171033/mumbai-indians.jpg',
    PBKS: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171034/punjab-kings.jpg',
    RR: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171035/rajasthan-royals.jpg',
    RCB: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171036/royal-challengers-bangalore.jpg',
    SRH: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c171037/sunrisers-hyderabad.jpg',
    LSG: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c228220/lucknow-super-giants.jpg',
    GT: 'https://static.cricbuzz.com/a/img/v1/152x152/i1/c228222/gujarat-titans.jpg'
};

const IPLBetting = () => {
    const { user, updateUser } = useContext(AuthContext);
    const socketRef = useRef(null);

    // Match data
    const [matchData, setMatchData] = useState(null);
    const [upcoming, setUpcoming] = useState([]);
    const [loading, setLoading] = useState(true);

    // Previous odds for flash animation
    const prevOddsRef = useRef({ team1: 0, team2: 0 });
    const [oddsFlash, setOddsFlash] = useState({ team1: false, team2: false });

    // Betting state
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [betAmount, setBetAmount] = useState('');
    const [placing, setPlacing] = useState(false);

    // User bets
    const [activeBets, setActiveBets] = useState([]);

    // ============================================
    // Socket connection
    // ============================================
    useEffect(() => {
        if (socketRef.current?.connected) return;

        socketRef.current = io(SOCKET_URL, {
            transports: ['websocket'],
            upgrade: false,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
            timeout: 20000
        });

        socketRef.current.on('connect', () => {
            socketRef.current.emit('join_ipl');
            if (user?.id) socketRef.current.emit('join_user_room', user.id);
        });

        // Live updates (every 45s)
        socketRef.current.on('ipl-update', (data) => {
            setLoading(false);
            setUpcoming(data.upcoming || []);

            const liveMatch = data.live?.[0] || null;
            const completedMatch = data.completed?.[0] || null;
            const current = liveMatch || completedMatch;

            if (current) {
                setMatchData(prev => {
                    // Detect odds changes for flash effect
                    if (prev && current.team1Odds !== prev.team1Odds) {
                        triggerOddsFlash('team1');
                    }
                    if (prev && current.team2Odds !== prev.team2Odds) {
                        triggerOddsFlash('team2');
                    }
                    return current;
                });
            } else {
                setMatchData(null);
            }
        });

        // Match ended
        socketRef.current.on('ipl-match-ended', (data) => {
            toast.success(`🏏 Match ended! ${data.winnerName} wins!`, { duration: 5000 });
            fetchActiveBets();
        });

        // Personal bet settlement
        socketRef.current.on('ipl-bet-settled', (data) => {
            if (data.won) {
                toast.success(`🎉 You won $${parseFloat(data.payout).toFixed(2)}!`, { duration: 5000 });
                if (data.newBalance !== null) updateUser({ cash: data.newBalance });
            } else {
                toast.error(`Better luck next time! Lost $${parseFloat(data.betAmount).toFixed(2)}`, { duration: 4000 });
            }
            fetchActiveBets();
        });

        // Betting closed
        socketRef.current.on('ipl-betting-closed', () => {
            toast('🔒 Betting is now closed (overs > 18.5)', { icon: '⚠️', duration: 3000 });
        });

        return () => {
            socketRef.current?.emit('leave_ipl');
            socketRef.current?.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // ============================================
    // Odds flash animation
    // ============================================
    const triggerOddsFlash = useCallback((team) => {
        setOddsFlash(prev => ({ ...prev, [team]: true }));
        setTimeout(() => setOddsFlash(prev => ({ ...prev, [team]: false })), 500);
    }, []);

    // ============================================
    // Fetch active bets
    // ============================================
    const fetchActiveBets = useCallback(async () => {
        try {
            const res = await api.get('/bet/ipl/active');
            if (res.data.success) setActiveBets(res.data.bets || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (user?.id) fetchActiveBets();
    }, [user?.id, fetchActiveBets]);

    // ============================================
    // Place bet
    // ============================================
    const handlePlaceBet = async () => {
        if (!selectedTeam || !betAmount || !matchData) return;

        const amount = parseFloat(betAmount);
        if (isNaN(amount) || amount < 10 || amount > 10000) {
            toast.error('Bet must be between $10 and $10,000');
            return;
        }

        if (!matchData.is_betting_open) {
            toast.error('Betting is closed for this match');
            return;
        }

        const odds = selectedTeam === matchData.team1
            ? matchData.team1Odds
            : matchData.team2Odds;

        setPlacing(true);
        try {
            const res = await api.post('/bet/ipl', {
                matchId: matchData.id,
                matchTitle: `${matchData.team1Name} vs ${matchData.team2Name}`,
                selectedTeam,
                betAmount: amount,
                currentOdds: odds
            });

            if (res.data.success) {
                toast.success(
                    `Bet placed! $${amount} on ${selectedTeam} at ×${odds} → potential $${parseFloat(res.data.bet.potentialPayout).toFixed(2)}`
                );
                updateUser({ cash: res.data.newBalance });
                setSelectedTeam(null);
                setBetAmount('');
                fetchActiveBets();
            } else {
                toast.error(res.data.message || 'Bet failed');
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to place bet');
        } finally {
            setPlacing(false);
        }
    };

    // ============================================
    // Computed values
    // ============================================
    const selectedOdds = matchData && selectedTeam
        ? (selectedTeam === matchData.team1 ? matchData.team1Odds : matchData.team2Odds)
        : 0;
    const potentialPayout = betAmount && selectedOdds
        ? (parseFloat(betAmount) * selectedOdds).toFixed(2)
        : '0.00';

    // ============================================
    // Render helpers
    // ============================================
    const formatDate = (iso) => {
        const d = new Date(iso);
        return d.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    };

    // ============================================
    // Loading state
    // ============================================
    if (loading) {
        return (
            <div className="ipl-page">
                <div className="ipl-no-match">
                    <div className="emoji">🏏</div>
                    <h2>Loading IPL data...</h2>
                    <p>Connecting to live feed</p>
                </div>
            </div>
        );
    }

    // ============================================
    // No match state
    // ============================================
    if (!matchData) {
        return (
            <div className="ipl-page">
                <div className="ipl-page-header">
                    <h1>🏏 IPL Betting</h1>
                </div>
                <div className="ipl-no-match">
                    <div className="emoji">🏟️</div>
                    <h2>No Live Matches</h2>
                    <p>Check back during IPL match hours for live betting</p>
                </div>
                {upcoming.length > 0 && (
                    <div className="ipl-panel" style={{ maxWidth: 500, margin: '24px auto' }}>
                        <h3>Upcoming Matches</h3>
                        {upcoming.map(m => (
                            <div key={m.id} className="upcoming-item">
                                <span className="upcoming-teams">
                                    {m.team1} vs {m.team2}
                                </span>
                                <span className="upcoming-date">{formatDate(m.date)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ============================================
    // Main render
    // ============================================
    const bettingOpen = matchData.is_betting_open && matchData.status === 'live';
    const isCompleted = matchData.status === 'completed';

    return (
        <div className="ipl-page">
            {/* Header */}
            <div className="ipl-page-header">
                <h1>🏏 IPL Betting</h1>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {matchData.status === 'live' && (
                        <span className="ipl-live-badge">
                            <span className="ipl-live-dot" />
                            LIVE
                        </span>
                    )}
                    {isCompleted && (
                        <span className="ipl-live-badge" style={{
                            background: 'rgba(255,71,87,0.12)',
                            borderColor: 'rgba(255,71,87,0.35)',
                            color: '#ff4757'
                        }}>
                            ENDED
                        </span>
                    )}
                </div>
            </div>

            <div className="ipl-grid">
                {/* ===== Main match card ===== */}
                <div className="ipl-match-card">
                    <div className="match-header">
                        <span className="match-title">
                            {matchData.venue || 'IPL 2026'}
                        </span>
                        <span className="match-title">
                            {matchData.innings === 2 ? '2nd Innings' : '1st Innings'}
                        </span>
                    </div>

                    {/* Teams */}
                    <div className="teams-display">
                        {/* Team 1 */}
                        <div
                            className={`team-block ${selectedTeam === matchData.team1 ? 'selected' : ''} ${!bettingOpen ? 'disabled' : ''}`}
                            onClick={() => bettingOpen && setSelectedTeam(matchData.team1)}
                        >
                            <div
                                className="team-logo-circle"
                                style={{ background: TEAM_COLORS[matchData.team1] || '#333' }}
                            >
                                {TEAM_LOGOS[matchData.team1] ? (
                                    <img src={TEAM_LOGOS[matchData.team1]} alt={matchData.team1} className="team-logo-img" />
                                ) : (
                                    matchData.team1
                                )}
                            </div>
                            <div className="team-name">{matchData.team1Name}</div>
                            <div className="team-score">
                                {matchData.team1Score}/{matchData.team1Wickets}
                            </div>
                            <div className="team-overs">({matchData.team1Overs} ov)</div>
                            <div className={`team-odds ${oddsFlash.team1 ? 'flash' : ''}`}>
                                ×{matchData.team1Odds?.toFixed(2)}
                            </div>
                        </div>

                        <span className="vs-badge">VS</span>

                        {/* Team 2 */}
                        <div
                            className={`team-block ${selectedTeam === matchData.team2 ? 'selected' : ''} ${!bettingOpen ? 'disabled' : ''}`}
                            onClick={() => bettingOpen && setSelectedTeam(matchData.team2)}
                        >
                            <div
                                className="team-logo-circle"
                                style={{ background: TEAM_COLORS[matchData.team2] || '#333' }}
                            >
                                {TEAM_LOGOS[matchData.team2] ? (
                                    <img src={TEAM_LOGOS[matchData.team2]} alt={matchData.team2} className="team-logo-img" />
                                ) : (
                                    matchData.team2
                                )}
                            </div>
                            <div className="team-name">{matchData.team2Name}</div>
                            <div className="team-score">
                                {matchData.team2Score}/{matchData.team2Wickets}
                            </div>
                            <div className="team-overs">({matchData.team2Overs} ov)</div>
                            <div className={`team-odds ${oddsFlash.team2 ? 'flash' : ''}`}>
                                ×{matchData.team2Odds?.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* Match status */}
                    <div className="match-status-text">
                        {matchData.statusText}
                        {matchData.innings === 2 && matchData.target > 0 && matchData.status === 'live' && (
                            <> &nbsp;| Target: {matchData.target}</>
                        )}
                    </div>

                    {/* Bet form */}
                    {!isCompleted && (
                        <div className="bet-form">
                            {/* Premium Amount Input */}
                            <div className="premium-bet-input-container">
                                <div className="premium-input-icon">$</div>
                                <input
                                    type="number"
                                    className="premium-bet-input"
                                    placeholder="Enter bet amount..."
                                    value={betAmount}
                                    onChange={(e) => setBetAmount(e.target.value)}
                                    min="10"
                                    max="10000"
                                    disabled={!bettingOpen}
                                />
                                <div className="premium-input-currency">USD</div>
                            </div>

                            {/* Potential payout */}
                            {selectedTeam && betAmount && (
                                <div className="potential-payout">
                                    <span className="label">
                                        Potential Payout ({selectedTeam} at ×{selectedOdds})
                                    </span>
                                    <span className="value">${potentialPayout}</span>
                                </div>
                            )}

                            {/* Place bet button */}
                            <button
                                className={`place-bet-btn ${!bettingOpen ? 'closed' : ''}`}
                                onClick={handlePlaceBet}
                                disabled={!bettingOpen || !selectedTeam || !betAmount || placing}
                            >
                                {placing
                                    ? 'Placing...'
                                    : !bettingOpen
                                        ? '🔒 Betting Closed'
                                        : !selectedTeam
                                            ? 'Select a Team'
                                            : `Place Bet on ${selectedTeam}`
                                }
                            </button>
                        </div>
                    )}

                    {isCompleted && matchData.winner && (
                        <div style={{
                            textAlign: 'center', marginTop: 20,
                            padding: '16px', background: 'rgba(0,255,136,0.06)',
                            borderRadius: 12, border: '1px solid rgba(0,255,136,0.2)'
                        }}>
                            <div style={{ fontSize: 40, marginBottom: 8 }}>🏆</div>
                            <div style={{
                                fontFamily: 'Orbitron', fontSize: 18,
                                fontWeight: 700, color: '#00ff88'
                            }}>
                                {matchData.winner} Wins!
                            </div>
                            <div style={{ fontSize: 13, color: '#7a8599', marginTop: 4 }}>
                                Bets have been settled automatically
                            </div>
                        </div>
                    )}
                </div>

                {/* ===== Sidebar ===== */}
                <div className="ipl-sidebar">
                    {/* Active bets */}
                    <div className="ipl-panel">
                        <h3>Your Bets</h3>
                        {activeBets.length === 0 ? (
                            <div className="no-bets-msg">No active bets</div>
                        ) : (
                            activeBets.map(bet => (
                                <div
                                    key={bet.id}
                                    className={`active-bet-item ${
                                        bet.status === 'won' ? 'settled-won' :
                                        bet.status === 'lost' ? 'settled-lost' : ''
                                    }`}
                                >
                                    <div>
                                        <div className="active-bet-team">{bet.selected_team}</div>
                                        <div className="active-bet-details">
                                            ${parseFloat(bet.bet_amount).toFixed(2)} at ×{parseFloat(bet.odds_at_placement).toFixed(2)}
                                        </div>
                                    </div>
                                    <div className="active-bet-payout">
                                        {bet.status === 'won' && '+'}${parseFloat(bet.potential_payout).toFixed(2)}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Upcoming matches */}
                    {upcoming.length > 0 && (
                        <div className="ipl-panel">
                            <h3>Upcoming</h3>
                            {upcoming.slice(0, 5).map(m => (
                                <div key={m.id} className="upcoming-item">
                                    <span className="upcoming-teams">
                                        {m.team1} vs {m.team2}
                                    </span>
                                    <span className="upcoming-date">
                                        {formatDate(m.date)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default IPLBetting;
