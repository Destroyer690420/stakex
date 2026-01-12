import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import toast from 'react-hot-toast';
import './Auth.css';

const ResetPassword = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [validSession, setValidSession] = useState(false);
    const [checking, setChecking] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                setValidSession(true);
            } else {
                toast.error('Invalid or expired reset link');
                setTimeout(() => navigate('/login'), 2000);
            }
            setChecking(false);
        };
        checkSession();
    }, [navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }

        setLoading(true);

        try {
            const { error } = await supabase.auth.updateUser({
                password: password
            });

            if (error) throw error;

            toast.success('Password updated successfully!');
            await supabase.auth.signOut();
            navigate('/login');
        } catch (err) {
            toast.error(err.message || 'Failed to update password');
        } finally {
            setLoading(false);
        }
    };

    if (checking) {
        return (
            <div className="auth-page">
                <div className="auth-page-bg"></div>
                <div className="auth-card-wrapper">
                    <div className="auth-card premium">
                        <div className="loading-spinner-container">
                            <div className="loading-spinner"></div>
                            <p className="loading-text">Verifying reset link...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!validSession) {
        return (
            <div className="auth-page">
                <div className="auth-page-bg"></div>
                <div className="auth-card-wrapper">
                    <div className="auth-card premium">
                        <div className="error-state">
                            <div className="error-icon">⚠️</div>
                            <h2>Invalid Link</h2>
                            <p>Redirecting to login...</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="auth-page">
            <div className="auth-page-bg"></div>
            <div className="auth-card-wrapper">
                <div className="auth-card premium">
                    <div className="auth-card-glow"></div>

                    {/* Logo */}
                    <div className="auth-logo">
                        <span className="logo-stake">Stake</span>
                        <span className="logo-x">X</span>
                    </div>

                    <div className="auth-header">
                        <div className="auth-icon-container">
                            <div className="auth-icon">🔑</div>
                        </div>
                        <h1 className="auth-title-premium">Create New Password</h1>
                        <p className="auth-subtitle-premium">
                            Your new password must be different from previous passwords.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="auth-form">
                        <div className="input-group-premium">
                            <label className="input-label-premium">
                                <span className="label-icon">🔒</span>
                                New Password
                            </label>
                            <div className="input-wrapper">
                                <input
                                    type="password"
                                    className="input-premium"
                                    placeholder="Enter new password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <div className="input-focus-ring"></div>
                            </div>
                            <span className="input-hint">Must be at least 6 characters</span>
                        </div>

                        <div className="input-group-premium">
                            <label className="input-label-premium">
                                <span className="label-icon">🔒</span>
                                Confirm Password
                            </label>
                            <div className="input-wrapper">
                                <input
                                    type="password"
                                    className="input-premium"
                                    placeholder="Confirm new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                />
                                <div className="input-focus-ring"></div>
                            </div>
                        </div>

                        <button
                            type="submit"
                            className="btn-gold-premium"
                            disabled={loading}
                        >
                            <span className="btn-text">
                                {loading ? 'Updating...' : 'Reset Password'}
                            </span>
                            <span className="btn-shine"></span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ResetPassword;
