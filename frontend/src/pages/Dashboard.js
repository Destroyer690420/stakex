import React, { useContext, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import './Dashboard.css';

// ============================================
// GAME REGISTRY - Add new games here
// ============================================
const games = [
    // Crash Games
    {
        id: 'aviator',
        name: 'Aviator',
        path: '/games/aviator',
        image: '/images/aviator.png',
        emoji: '✈️',
        category: 'crash',
        featured: true,
        hot: true
    },
    // Originals
    {
        id: 'slots',
        name: 'Slots',
        path: '/games/slots',
        image: '/images/slot.png',
        emoji: '🎰',
        category: 'originals',
        featured: true
    },
    {
        id: 'coinflip',
        name: 'Coin Flip',
        path: '/games/coinflip',
        image: '/images/flip.png',
        emoji: '🪙',
        category: 'originals',
        featured: true
    },
    {
        id: 'mines',
        name: 'Mines',
        path: '/games/mines',
        image: '/images/mines.png',
        emoji: '💎',
        category: 'originals',
        featured: true
    },
    {
        id: 'roulette',
        name: 'Roulette',
        path: '/games/roulette',
        image: '/images/roulette.png',
        emoji: '🎡',
        category: 'table',
        featured: true
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

// Category definitions
const categories = [
    {
        id: 'crash',
        name: 'Crash Games',
        icon: '🚀',
        subtitle: 'Ride the multiplier'
    },
    {
        id: 'originals',
        name: 'StakeX Originals',
        icon: '⚡',
        subtitle: 'Exclusive games with the best odds'
    },
    {
        id: 'table',
        name: 'Table Games',
        icon: '🃏',
        subtitle: 'Classic casino experience'
    }
];

// Game tile component with image fallback
const GameTile = ({ game }) => {
    const [imageError, setImageError] = useState(false);

    return (
        <Link to={game.path} className="game-tile">
            <div className="game-image-container">
                {game.hot && <span className="game-badge hot">HOT</span>}
                {game.new && <span className="game-badge new">NEW</span>}

                {!imageError ? (
                    <img
                        src={game.image}
                        alt={game.name}
                        className="game-image"
                        onError={() => setImageError(true)}
                        loading="lazy"
                    />
                ) : (
                    <div className="game-fallback">
                        <span className="fallback-emoji">{game.emoji}</span>
                    </div>
                )}
                <div className="game-overlay">
                    <span className="game-name-overlay">{game.name}</span>
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

// Scrollable game row component
const GameRow = ({ category, games }) => {
    const scrollRef = useRef(null);

    const scroll = (direction) => {
        if (scrollRef.current) {
            const scrollAmount = 280;
            scrollRef.current.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };

    if (games.length === 0) return null;

    return (
        <section className="games-section">
            <div className="section-header">
                <h2 className="section-title">
                    <span className="title-icon">{category.icon}</span>
                    {category.name}
                </h2>
                <p className="section-subtitle">{category.subtitle}</p>
            </div>

            <div className="games-row-container">
                <button
                    className="scroll-btn scroll-left"
                    onClick={() => scroll('left')}
                    aria-label="Scroll left"
                >
                    ‹
                </button>

                <div className="games-row" ref={scrollRef}>
                    {games.map(game => (
                        <GameTile key={game.id} game={game} />
                    ))}
                </div>

                <button
                    className="scroll-btn scroll-right"
                    onClick={() => scroll('right')}
                    aria-label="Scroll right"
                >
                    ›
                </button>
            </div>
        </section>
    );
};

const Dashboard = () => {
    const { user } = useContext(AuthContext);

    // Get games for each category
    const getGamesByCategory = (categoryId) => {
        return games.filter(g => g.category === categoryId);
    };

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

            {/* Game Categories - Each with horizontal scroll */}
            {categories.map(category => (
                <GameRow
                    key={category.id}
                    category={category}
                    games={getGamesByCategory(category.id)}
                />
            ))}

            {/* Quick Actions */}
            <section className="quick-actions">
                <Link to="/profile" className="quick-action-card">
                    <div className="action-icon">👤</div>
                    <div className="action-text">
                        <span className="action-title">View Profile</span>
                        <span className="action-desc">Stats & History</span>
                    </div>
                </Link>
                <Link to="/friends" className="quick-action-card">
                    <div className="action-icon">👥</div>
                    <div className="action-text">
                        <span className="action-title">Friends</span>
                        <span className="action-desc">Chat & compete</span>
                    </div>
                </Link>
                <Link to="/leaderboard" className="quick-action-card">
                    <div className="action-icon">🏆</div>
                    <div className="action-text">
                        <span className="action-title">Leaderboard</span>
                        <span className="action-desc">Top players</span>
                    </div>
                </Link>
            </section>
        </div>
    );
};

export default Dashboard;
