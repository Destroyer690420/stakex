import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import RegisterForm from '../components/auth/RegisterForm';
import './Auth.css';

const Register = () => {
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
                        <p className="auth-subtitle">Create your account</p>
                    </div>

                    <RegisterForm onSuccess={() => navigate('/dashboard')} />

                    <div className="text-center mt-3">
                        <p className="mb-0 text-muted" style={{ fontSize: '14px' }}>
                            Already have an account?{' '}
                            <Link to="/login" className="link-gold">
                                Sign in
                            </Link>
                        </p>
                    </div>

                    <div className="auth-divider"></div>

                    <div className="text-center">
                        <p className="text-muted small mb-1" style={{ fontSize: '13px', color: '#d4af37' }}>Get $1,000 free cash on signup!</p>
                        <p className="text-muted small mb-0" style={{ fontSize: '12px' }}>This is a simulation. No real money involved.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Register;
