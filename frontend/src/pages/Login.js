import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import LoginForm from '../components/auth/LoginForm';
import './Auth.css';

const Login = () => {
    const { isAuthenticated } = useContext(AuthContext);
    const navigate = useNavigate();

    // Redirect if already logged in
    React.useEffect(() => {
        if (isAuthenticated) {
            navigate('/dashboard');
        }
    }, [isAuthenticated, navigate]);

    return (
        <div className="auth-page">
            <div className="col-md-5" style={{ maxWidth: '480px', width: '100%' }}>
                <div className="auth-card p-4">
                    <div className="text-center mb-4">
                        <h1 className="h3 mb-2">
                            <span style={{ color: '#fff', fontWeight: 'bold' }}>Stake</span>
                            <span style={{ color: '#d4af37', fontWeight: 'bold' }}>X</span>
                        </h1>
                        <p className="auth-subtitle">Sign in to play</p>
                    </div>

                    <LoginForm onSuccess={() => navigate('/dashboard')} />

                    <div className="text-center mt-3">
                        <p className="mb-0 text-muted" style={{ fontSize: '14px' }}>
                            Don't have an account?{' '}
                            <Link to="/register" className="link-gold">
                                Sign up
                            </Link>
                        </p>
                    </div>

                    <div className="auth-divider"></div>

                    <p className="text-center text-muted small mb-0" style={{ fontSize: '12px' }}>
                        This is a simulation. No real money involved.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
