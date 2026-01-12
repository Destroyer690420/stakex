import React, { useState, useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const LoginForm = ({ onSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useContext(AuthContext);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            await login(email, password);
            if (onSuccess) onSuccess();
        } catch (err) {
            const message = err.message || 'Login failed. Please try again.';
            // Check for specific error cases
            if (message.toLowerCase().includes('email not confirmed') ||
                message.toLowerCase().includes('not verified')) {
                toast.error('Please verify your email address first.');
            } else if (message.toLowerCase().includes('invalid') ||
                message.toLowerCase().includes('credentials') ||
                message.toLowerCase().includes('password') ||
                message.toLowerCase().includes('user not found')) {
                toast.error('Invalid email or password. Please try again.');
            } else {
                toast.error(message);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="mb-3">
                <label className="auth-label">Email</label>
                <input
                    type="email"
                    className="auth-input w-100"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />
            </div>

            <div className="mb-3">
                <label className="auth-label">Password</label>
                <input
                    type="password"
                    className="auth-input w-100"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                />
            </div>

            <div className="mb-4 text-end">
                <Link to="/forgot-password" className="forgot-password-link">
                    Forgot Password?
                </Link>
            </div>

            <button
                type="submit"
                className="btn-gold w-100 mb-3"
                disabled={loading}
            >
                {loading ? (
                    <span className="spinner-border spinner-border-sm me-2" />
                ) : null}
                {loading ? 'Signing in...' : 'Sign In'}
            </button>
        </form>
    );
};

export default LoginForm;
