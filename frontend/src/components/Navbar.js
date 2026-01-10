import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const Navbar = () => {
    const { user, logout, isAuthenticated } = useContext(AuthContext);
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <nav className="navbar navbar-expand-lg navbar-dark">
            <div className="container">
                <Link className="navbar-brand fw-bold" to="/">
                    🎰 <span style={{ color: '#ffd700' }}>Stake</span>
                    <span style={{ color: '#e94560' }}>X</span>
                </Link>

                <button
                    className="navbar-toggler"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target="#navbarNav"
                >
                    <span className="navbar-toggler-icon"></span>
                </button>

                <div className="collapse navbar-collapse" id="navbarNav">
                    {isAuthenticated ? (
                        <>
                            <ul className="navbar-nav me-auto">
                                <li className="nav-item">
                                    <Link className="nav-link" to="/dashboard">
                                        🏠 Dashboard
                                    </Link>
                                </li>
                                <li className="nav-item dropdown">
                                    <span
                                        className="nav-link dropdown-toggle"
                                        role="button"
                                        data-bs-toggle="dropdown"
                                    >
                                        🎮 Games
                                    </span>
                                    <ul className="dropdown-menu dropdown-menu-dark">
                                        <li>
                                            <Link className="dropdown-item" to="/games/slots">
                                                🎰 Slots
                                            </Link>
                                        </li>
                                        <li>
                                            <Link className="dropdown-item" to="/games/coinflip">
                                                🪙 Coin Flip
                                            </Link>
                                        </li>
                                        <li>
                                            <Link className="dropdown-item" to="/games/poker">
                                                🃏 Poker
                                            </Link>
                                        </li>
                                    </ul>
                                </li>
                                <li className="nav-item">
                                    <Link className="nav-link" to="/profile">
                                        👤 Profile
                                    </Link>
                                </li>
                                {user?.isAdmin && (
                                    <li className="nav-item">
                                        <Link className="nav-link text-warning" to="/admin">
                                            ⚙️ Admin
                                        </Link>
                                    </li>
                                )}
                            </ul>

                            <div className="d-flex align-items-center gap-3">
                                <span className="cash-display">
                                    💰 ${user?.cash?.toLocaleString() || 0}
                                </span>
                                <span className="text-light">
                                    Hi, {user?.username}
                                </span>
                                <button
                                    className="btn btn-outline-light btn-sm"
                                    onClick={handleLogout}
                                >
                                    Logout
                                </button>
                            </div>
                        </>
                    ) : (
                        <ul className="navbar-nav ms-auto">
                            <li className="nav-item">
                                <Link className="nav-link" to="/login">
                                    Login
                                </Link>
                            </li>
                            <li className="nav-item">
                                <Link className="btn btn-primary btn-sm ms-2" to="/register">
                                    Sign Up
                                </Link>
                            </li>
                        </ul>
                    )}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
