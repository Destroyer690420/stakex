import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import LoginForm from '../components/auth/LoginForm';

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
        <div className="row justify-content-center mt-5">
            <div className="col-md-5">
                <div className="card p-4">
                    <div className="text-center mb-4">
                        <h1 className="h3">
                            🎰 <span style={{ color: '#ffd700' }}>Stake</span>
                            <span style={{ color: '#e94560' }}>X</span>
                        </h1>
                        <p className="text-muted">Sign in to play</p>
                    </div>

                    <LoginForm onSuccess={() => navigate('/dashboard')} />

                    <div className="text-center">
                        <p className="mb-0">
                            Don't have an account?{' '}
                            <Link to="/register" className="text-decoration-none" style={{ color: '#e94560' }}>
                                Sign up
                            </Link>
                        </p>
                    </div>

                    <hr className="my-4" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />

                    <p className="text-center text-muted small mb-0">
                        ⚠️ This is a simulation. No real money involved.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Login;
