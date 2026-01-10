import React, { useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import RegisterForm from '../components/auth/RegisterForm';

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
        <div className="row justify-content-center mt-5">
            <div className="col-md-5">
                <div className="card p-4">
                    <div className="text-center mb-4">
                        <h1 className="h3">
                            🎰 <span style={{ color: '#ffd700' }}>Stake</span>
                            <span style={{ color: '#e94560' }}>X</span>
                        </h1>
                        <p className="text-muted">Create your account</p>
                    </div>

                    <RegisterForm onSuccess={() => navigate('/dashboard')} />

                    <div className="text-center">
                        <p className="mb-0">
                            Already have an account?{' '}
                            <Link to="/login" className="text-decoration-none" style={{ color: '#e94560' }}>
                                Sign in
                            </Link>
                        </p>
                    </div>

                    <hr className="my-4" style={{ borderColor: 'rgba(255,255,255,0.1)' }} />

                    <div className="text-center">
                        <p className="text-muted small mb-1">🎁 Get $1,000 free cash on signup!</p>
                        <p className="text-muted small mb-0">⚠️ This is a simulation. No real money involved.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Register;
