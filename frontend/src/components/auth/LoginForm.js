import React, { useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';

const LoginForm = ({ onSuccess }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useContext(AuthContext);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(email, password);
            // Determine user role or successful login action if needed
            if (onSuccess) onSuccess();
        } catch (err) {
            setError(err.message || err.response?.data?.message || 'Login failed. Please try again.');
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

                <div className="mb-4">
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
        </>
    );
};

export default LoginForm;
