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
        featured: true
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
        id: 'dice',
        name: 'Dice',
        path: '/games/dice',
        image: '/images/dice.png',
        emoji: '🎲',
        category: 'originals',
        featured: true
    },
    {
        id: 'tower',
        name: 'Tower',
        path: '/games/tower',
        image: '/images/tower.png',
        emoji: '🗼',
        category: 'originals',
        featured: true,
        new: true
    },
    {
        id: 'uno',
        name: 'Uno',
        path: '/games/uno',
        image: '/images/uno.png',
        emoji: '🃏',
        category: 'table',
        featured: true,
        new: true
    },
    {
        id: 'baccarat',
        name: 'Baccarat',
        path: '/games/baccarat',
        image: '/images/baccarat.png',
        emoji: '🎴',
        category: 'table',
        featured: true,
        new: true
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
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M2.5 19.6L3.8 20.9C4.5 21.6 5.6 21.6 6.3 20.9L12 15.2C12.4 15.3 12.8 15.3 13.2 15.3C15.8 15.3 18.2 14.1 19.8 12.1L21.3 13.6C21.7 14 22.3 14 22.7 13.6C23.1 13.2 23.1 12.6 22.7 12.2L11 0.5C10.6 0.1 10 0.1 9.6 0.5L11.1 2C9.1 3.6 7.9 6 7.9 8.6C7.9 9 7.9 9.4 8 9.8L2.3 15.5C1.6 16.2 1.6 17.3 2.5 19.6Z" />
                <path d="M15 17L13.5 15.5C13.5 15.5 12.8 17.5 13.2 18.5C13.6 19.5 15.5 22.5 15.5 22.5C15.5 22.5 16.9 21.6 17.5 20.6C18.1 19.6 19.5 17.5 19.5 17.5L18 16L15 17Z" />
            </svg>
        ),
        subtitle: 'Ride the multiplier'
    },
    {
        id: 'originals',
        name: 'StakeX Originals',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M11 21H7V13H4L13 3V11H16L7 21Z" />
            </svg>
        ),
        subtitle: 'Exclusive games with the best odds'
    },
    {
        id: 'table',
        name: 'Table Games',
        icon: (
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M19.5 3H4.5C3.7 3 3 3.7 3 4.5V19.5C3 20.3 3.7 21 4.5 21H19.5C20.3 21 21 20.3 21 19.5V4.5C21 3.7 20.3 3 19.5 3ZM19.5 19.5H4.5V4.5H19.5V19.5Z" />
                <path d="M7.5 16.5C8.3 16.5 9 15.8 9 15C9 14.2 8.3 13.5 7.5 13.5C6.7 13.5 6 14.2 6 15C6 15.8 6.7 16.5 7.5 16.5Z" />
                <path d="M16.5 16.5C17.3 16.5 18 15.8 18 15C18 14.2 17.3 13.5 16.5 13.5C15.7 13.5 15 14.2 15 15C15 15.8 15.7 16.5 16.5 16.5Z" />
                <path d="M7.5 10.5C8.3 10.5 9 9.8 9 9C9 8.2 8.3 7.5 7.5 7.5C6.7 7.5 6 8.2 6 9C6 9.8 6.7 10.5 7.5 10.5Z" />
                <path d="M16.5 10.5C17.3 10.5 18 9.8 18 9C18 8.2 17.3 7.5 16.5 7.5C15.7 7.5 15 8.2 15 9C15 9.8 15.7 10.5 16.5 10.5Z" />
                <path d="M12 13.5C12.8 13.5 13.5 12.8 13.5 12C13.5 11.2 12.8 10.5 12 10.5C11.2 10.5 10.5 11.2 10.5 12C10.5 12.8 11.2 13.5 12 13.5Z" />
            </svg>
        ),
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
                    <span className="play-button">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                        </svg>
                    </span>
                </div>
            </div>
            <div className="game-info">
                <span className="game-name">{game.name}</span>
            </div>
        </Link>
    );
};

// Scrollable game row component
const GameRow = ({ category, games }) => {
    const scrollRef = useRef(null);

    const scroll = (direction) => {
        if (scrollRef.current) {
            const scrollAmount = 240;
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
                <span className="title-icon">{category.icon}</span>
                <div className="header-text">
                    <h2 className="section-title">
                        {category.name}
                    </h2>
                </div>
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
