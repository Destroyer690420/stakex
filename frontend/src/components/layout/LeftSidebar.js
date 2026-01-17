import React, { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import './LeftSidebar.css';

const LeftSidebar = ({ collapsed }) => {
    const { user } = useContext(AuthContext);

    return (
        <aside className={`left-sidebar ${collapsed ? 'collapsed' : ''}`}>
            {/* Navigation Sections */}
            <nav className="sidebar-nav">
                {/* Main Menu */}
                <div className="nav-section">
                    <NavLink to="/dashboard" className="nav-item" end>
                        <span className="nav-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                                <path d="M0 0h24v24H0z" fill="none" />
                            </svg>
                        </span>
                        {!collapsed && <span className="nav-text">Home</span>}
                    </NavLink>
                    <NavLink to="/profile" className="nav-item">
                        <span className="nav-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                                <path d="M0 0h24v24H0z" fill="none" />
                            </svg>
                        </span>
                        {!collapsed && <span className="nav-text">Profile</span>}
                    </NavLink>
                    <NavLink to="/friends" className="nav-item">
                        <span className="nav-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
                                <path d="M0 0h24v24H0z" fill="none" />
                            </svg>
                        </span>
                        {!collapsed && <span className="nav-text">Friends</span>}
                    </NavLink>
                    <NavLink to="/leaderboard" className="nav-item">
                        <span className="nav-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 12h-2v-5h2v5zm4 0h-2v-3h2v3zm-8 0H6v-7h2v7z" />
                                <path d="M0 0h24v24H0z" fill="none" />
                            </svg>
                        </span>
                        {!collapsed && <span className="nav-text">Leaderboard</span>}
                    </NavLink>

                    {/* Admin Only Link */}
                    {user?.is_admin && (
                        <NavLink to="/admin" className="nav-item text-teal">
                            <span className="nav-icon">
                                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                                    <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" />
                                    <path d="M0 0h24v24H0z" fill="none" />
                                </svg>
                            </span>
                            {!collapsed && <span className="nav-text">Admin</span>}
                        </NavLink>
                    )}
                </div>
            </nav>
        </aside>
    );
};

export default LeftSidebar;
