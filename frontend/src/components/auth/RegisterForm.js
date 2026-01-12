import React, { useState, useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const RegisterForm = ({ onSuccess }) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const { register } = useContext(AuthContext);

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
            const result = await register(username, email, password);

            if (result.emailConfirmationRequired) {
                // Email confirmation required - show success message and clear form
                toast.success('Account created! Please check your email to verify your account before logging in.');
                setUsername('');
                setEmail('');
                setPassword('');
                setConfirmPassword('');
                // Don't redirect - let user read the message
            } else {
                // Direct login successful
                if (onSuccess) onSuccess();
            }
        } catch (err) {
            const message = err.message || 'Registration failed. Please try again.';
            toast.error(message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
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
