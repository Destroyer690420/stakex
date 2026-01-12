import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../services/supabase';
import toast from 'react-hot-toast';
import './Auth.css';

const ForgotPassword = () => {
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`
            });

            if (error) throw error;

            setSent(true);
            toast.success('Password reset email sent!');
        } catch (err) {
            toast.error(err.message || 'Failed to send reset email');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="auth-page">
            <div className="auth-page-bg"></div>
            <div className="auth-card-wrapper">
                <div className="auth-card premium">
                    {/* Decorative Elements */}
                    <div className="auth-card-glow"></div>

                    {/* Logo */}
                    <div className="auth-logo">
                        <span className="logo-stake">Stake</span>
                        <span className="logo-x">X</span>
                    </div>

                    {sent ? (
                        <div className="success-state">
                            <div className="success-icon-container">
                                <div className="success-icon-ring"></div>
                                <div className="success-icon">✉️</div>
                            </div>
                            <h2 className="success-title">Check Your Email</h2>
                            <p className="success-text">
                                We've sent a password reset link to
                            </p>
                            <p className="success-email">{email}</p>
                            <p className="success-hint">
                                Click the link in the email to reset your password.
                            </p>
                            <Link to="/login" className="btn-gold-premium">
                                <span className="btn-text">Back to Login</span>
                                <span className="btn-shine"></span>
                            </Link>
                        </div>
                    ) : (
                        <>
                            <div className="auth-header">
                                <div className="auth-icon-container">
                                    <div className="auth-icon">🔐</div>
                                </div>
                                <h1 className="auth-title-premium">Forgot Password?</h1>
                                <p className="auth-subtitle-premium">
                                    No worries! Enter your email and we'll send you a reset link.
                                </p>
                            </div>

                            <form onSubmit={handleSubmit} className="auth-form">
                                <div className="input-group-premium">
                                    <label className="input-label-premium">
                                        <span className="label-icon">📧</span>
                                        Email Address
                                    </label>
                                    <div className="input-wrapper">
                                        <input
                                            type="email"
                                            className="input-premium"
                                            placeholder="Enter your email"
                                            value={email}
                                            onChange={(e) => setEmail(e.target.value)}
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
                                        {loading ? 'Sending...' : 'Send Reset Link'}
                                    </span>
                                    <span className="btn-shine"></span>
                                </button>
                            </form>

                            <div className="auth-footer-premium">
                                <Link to="/login" className="back-link">
                                    <span className="back-arrow">←</span>
                                    Back to Sign In
                                </Link>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ForgotPassword;
