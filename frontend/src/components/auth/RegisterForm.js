import React, { useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';

const RegisterForm = ({ onSuccess }) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { register } = useContext(AuthContext);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }

        setLoading(true);

        try {
            await register(username, email, password);
            if (onSuccess) onSuccess();
        } catch (err) {
            setError(err.message || err.response?.data?.message || 'Registration failed. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            {error && (
                <div className="alert alert-danger" role="alert">
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div className="mb-3">
                    <label className="auth-label">Username</label>
                    <input
                        type="text"
                        className="auth-input w-100"
                        placeholder="Choose a username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        minLength={3}
                        maxLength={20}
                        required
                    />
                </div>

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
                        placeholder="Create a password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={6}
                        required
                    />
                </div>

                <div className="mb-4">
                    <label className="auth-label">Confirm Password</label>
                    <input
                        type="password"
                        className="auth-input w-100"
                        placeholder="Confirm your password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />
                </div>

                <button
                    type="submit"
                    className="btn-gold w-100 mb-3"
                    disabled={loading}
                >
                    {loading ? (
                        <span className="spinner-border spinner-border-sm me-2" />
                    ) : null}
                    {loading ? 'Creating account...' : 'Create Account'}
                </button>
            </form>
        </>
    );
};

export default RegisterForm;
