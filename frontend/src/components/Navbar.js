import React, { useContext, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import './Navbar.css';

const Navbar = () => {
    const { user, logout, isAuthenticated } = useContext(AuthContext);
    const navigate = useNavigate();
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleLogout = () => {
        logout();
        navigate('/login');
        setIsMobileMenuOpen(false);
    };

    const isActive = (path) => location.pathname === path;
    const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
    const closeMobileMenu = () => setIsMobileMenuOpen(false);

    const isUnoGame = location.pathname.startsWith('/games/uno/');

    if (!isAuthenticated) {
        return (
            <nav className={`navbar-premium ${isUnoGame ? 'mobile-hidden' : ''}`}>
                <div className="navbar-container">
                    <Link to="/" className="navbar-logo">
                        <span className="logo-stake">Stake</span>
                        <span className="logo-x">X</span>
                    </Link>
                    <div className="navbar-auth">
                        <Link to="/login" className="auth-btn login-btn">Login</Link>
                        <Link to="/register" className="auth-btn register-btn">Sign Up</Link>
                    </div>
                </div>
            </nav>
        );
    }

    return (
        <nav className={`navbar-premium ${isUnoGame ? 'mobile-hidden' : ''}`}>
            <div className="navbar-container">
                {/* Logo */}
                <Link to="/dashboard" className="navbar-logo" onClick={closeMobileMenu}>
                    <span className="logo-stake">Stake</span>
                    <span className="logo-x">X</span>
                </Link>

                {/* Desktop Navigation */}
                <div className="desktop-nav">
                    <div className="navbar-nav">
                        <Link to="/dashboard" className={`nav-icon-link ${isActive('/dashboard') ? 'active' : ''}`} title="Home">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                <polyline points="9 22 9 12 15 12 15 22"></polyline>
                            </svg>
                        </Link>

                        <div className="nav-dropdown">
                            <button className="nav-icon-link" title="Games">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                                    <circle cx="12" cy="12" r="2"></circle>
                                    <path d="M6 12h.01M18 12h.01"></path>
                                </svg>
                            </button>
                            <div className="dropdown-menu">
                                <Link to="/games/slots" className="dropdown-item">
                                    <span className="dropdown-icon">🎰</span> Slots
                                </Link>
                                <Link to="/games/coinflip" className="dropdown-item">
                                    <span className="dropdown-icon">🪙</span> Coin Flip
                                </Link>
                                <Link to="/games/mines" className="dropdown-item">
                                    <span className="dropdown-icon">💣</span> Mines
                                </Link>
                                <Link to="/games/roulette" className="dropdown-item">
                                    <span className="dropdown-icon">🎡</span> Roulette
                                </Link>
                                <Link to="/games/aviator" className="dropdown-item">
                                    <span className="dropdown-icon">✈️</span> Aviator
                                </Link>
                                <Link to="/games/poker" className="dropdown-item">
                                    <span className="dropdown-icon">🃏</span> Poker
                                </Link>
                            </div>
                        </div>

                        <Link to="/profile" className={`nav-icon-link ${isActive('/profile') ? 'active' : ''}`} title="Profile">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </Link>

                        <Link to="/friends" className={`nav-icon-link ${isActive('/friends') ? 'active' : ''}`} title="Friends">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </Link>

                        <Link to="/leaderboard" className={`nav-icon-link ${isActive('/leaderboard') ? 'active' : ''}`} title="Leaderboard">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                                <path d="M4 22h16"></path>
                                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
                            </svg>
                        </Link>

                        {user?.is_admin && (
                            <Link to="/admin" className={`nav-icon-link admin-link ${isActive('/admin') ? 'active' : ''}`} title="Admin">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="3"></circle>
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                                </svg>
                            </Link>
                        )}
                    </div>

                    <div className="navbar-right">
                        <div className="balance-display">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="wallet-icon">
                                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path>
                                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path>
                                <path d="M18 12a2 2 0 0 0 0 4h4v-4z"></path>
                            </svg>
                            <span className="balance-amount">${parseFloat(user?.cash || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                        <button onClick={handleLogout} className="nav-icon-link logout-btn" title="Logout">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                <polyline points="16 17 21 12 16 7"></polyline>
                                <line x1="21" y1="12" x2="9" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Toggle */}
                <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="3" y1="12" x2="21" y2="12"></line>
                        <line x1="3" y1="6" x2="21" y2="6"></line>
                        <line x1="3" y1="18" x2="21" y2="18"></line>
                    </svg>
                </button>

                {/* Mobile Sidebar */}
                <div className={`mobile-sidebar-overlay ${isMobileMenuOpen ? 'open' : ''}`} onClick={closeMobileMenu}></div>
                <div className={`mobile-sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
                    <div className="sidebar-header">
                        <span className="sidebar-title">Menu</span>
                        <button className="close-sidebar-btn" onClick={closeMobileMenu}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>

                    <div className="sidebar-content">
                        {/* User Info */}
                        <div className="sidebar-user-card">
                            <div className="user-info">
                                <span className="user-name">{user?.username}</span>
                                <div className="user-balance">
                                    ${parseFloat(user?.cash || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>
                        </div>

                        {/* Navigation Links */}
                        <div className="sidebar-links">
                            <Link to="/dashboard" className={`sidebar-link ${isActive('/dashboard') ? 'active' : ''}`} onClick={closeMobileMenu}>
                                Home
                            </Link>
                            <Link to="/profile" className={`sidebar-link ${isActive('/profile') ? 'active' : ''}`} onClick={closeMobileMenu}>
                                Profile
                            </Link>
                            <Link to="/friends" className={`sidebar-link ${isActive('/friends') ? 'active' : ''}`} onClick={closeMobileMenu}>
                                👥 Friends
                            </Link>
                            <Link to="/leaderboard" className={`sidebar-link ${isActive('/leaderboard') ? 'active' : ''}`} onClick={closeMobileMenu}>
                                🏆 Leaderboard
                            </Link>

                            {user?.is_admin && (
                                <>
                                    <div className="sidebar-section-title">Admin</div>
                                    <Link to="/admin" className={`sidebar-link admin-link ${isActive('/admin') ? 'active' : ''}`} onClick={closeMobileMenu}>
                                        Dashboard
                                    </Link>
                                </>
                            )}
                        </div>

                        <div className="sidebar-footer">
                            <button onClick={handleLogout} className="sidebar-logout-btn">
                                Logout
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
