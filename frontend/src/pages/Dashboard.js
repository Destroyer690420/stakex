import React, { useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import './Dashboard.css';

// Game data with images and emoji fallbacks
const games = [
    {
        id: 'slots',
        name: 'Slots',
        path: '/games/slots',
        image: '/images/slot.png',
        emoji: '🎰',
        category: 'originals'
    },
    {
        id: 'coinflip',
        name: 'Coin Flip',
        path: '/games/coinflip',
        image: '/images/flip.png',
        emoji: '🪙',
        category: 'originals'
    },
    {
        id: 'mines',
        name: 'Mines',
        path: '/games/mines',
        image: '/images/mines.png',
        emoji: '💎',
        category: 'originals'
    },
    {
        id: 'roulette',
        name: 'Roulette',
        path: '/games/roulette',
        image: '/images/roulette.png',
        emoji: '🎡',
        category: 'originals'
    },
    {
        id: 'poker',
        name: 'Poker',
        path: '/games/poker',
        image: '/images/poker.png',
        emoji: '🃏',
        category: 'table'
    }
];

// Game tile component with fallback
const GameTile = ({ game }) => {
    const [imageError, setImageError] = useState(false);

    return (
        <Link to={game.path} className="game-tile">
            <div className="game-image-container">
                {!imageError ? (
                    <img
                        src={game.image}
                        alt={game.name}
                        className="game-image"
                        onError={() => setImageError(true)}
                    />
                ) : (
                    <div className="game-fallback">
                        <span className="fallback-emoji">{game.emoji}</span>
                        <span className="fallback-name">{game.name}</span>
                    </div>
                )}
                <div className="game-overlay">
                    <span className="play-button">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </span>
                </div>
            </div>
        </Link>
    );
};

const Dashboard = () => {
    const { user } = useContext(AuthContext);

    const originalsGames = games.filter(g => g.category === 'originals');
    const tableGames = games.filter(g => g.category === 'table');

    return (
        <div className="dashboard-wrapper">
            {/* Welcome Banner */}
            <div className="welcome-banner">
                <div className="welcome-content">
                    <h1 className="welcome-title">
                        Welcome back, <span className="username-highlight">{user?.username || 'Player'}</span>
                    </h1>
                    <p className="welcome-subtitle">Ready to test your luck?</p>
                </div>
                <div className="welcome-stats">
                    <div className="stat-item">
                        <span className="stat-value">${parseFloat(user?.cash || 0).toLocaleString()}</span>
                        <span className="stat-label">Balance</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{user?.stats?.gamesPlayed || 0}</span>
                        <span className="stat-label">Games Played</span>
                    </div>
                    <div className="stat-item">
                        <span className="stat-value">{user?.stats?.wins || 0}</span>
                        <span className="stat-label">Wins</span>
                    </div>
                </div>
            </div>

            {/* StakeX Originals Section */}
            <section className="games-section">
                <div className="section-header">
                    <h2 className="section-title">
                        <span className="title-icon">⚡</span>
                        StakeX Originals
                    </h2>
                    <p className="section-subtitle">Exclusive games with the best odds</p>
                </div>
                <div className="games-grid">
                    {originalsGames.map(game => (
                        <GameTile key={game.id} game={game} />
                    ))}
                </div>
            </section>

            {/* Table Games Section */}
            <section className="games-section">
                <div className="section-header">
                    <h2 className="section-title">
                        <span className="title-icon">🃏</span>
                        Table Games
                    </h2>
                    <p className="section-subtitle">Classic casino experience</p>
                </div>
                <div className="games-grid">
                    {tableGames.map(game => (
                        <GameTile key={game.id} game={game} />
                    ))}
                </div>
            </section>

            {/* Quick Actions */}
            <section className="quick-actions">
                <Link to="/profile" className="quick-action-card">
                    <div className="action-icon">👤</div>
                    <div className="action-text">
                        <span className="action-title">View Profile</span>
                        <span className="action-desc">Stats & History</span>
                    </div>
                </Link>
                <div className="quick-action-card promo-card">
                    <div className="action-icon">🎁</div>
                    <div className="action-text">
                        <span className="action-title">Daily Bonus</span>
                        <span className="action-desc">Claim your rewards</span>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Dashboard;
