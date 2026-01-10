import React, { createContext, useState, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';
import api from '../services/api';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Check for existing token on mount
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (token) {
            loadUser();
        } else {
            setLoading(false);
        }
    }, []);

    // Load user from API
    const loadUser = async () => {
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                setLoading(false);
                return;
            }

            // Immediate state update from token
            try {
                const decoded = jwtDecode(token);
                // Check expiration
                const currentTime = Date.now() / 1000;
                if (decoded.exp < currentTime) {
                    localStorage.removeItem('token');
                    setUser(null);
                    setIsAuthenticated(false);
                    setLoading(false);
                    return;
                }
                // Set basic user info from token immediately
                // Note: token might not have latest cash balance, so we still fetch /me
                setUser(prev => prev || { ...decoded, id: decoded.id });
                setIsAuthenticated(true);
            } catch (e) {
                console.error('Invalid token', e);
            }

            const response = await api.get('/auth/me');
            setUser(response.data.user);
            setIsAuthenticated(true);
        } catch (error) {
            console.error('Load user error:', error);
            localStorage.removeItem('token');
            setUser(null);
            setIsAuthenticated(false);
        } finally {
            setLoading(false);
        }
    };

    // Register
    const register = async (username, email, password) => {
        const response = await api.post('/auth/register', { username, email, password });
        localStorage.setItem('token', response.data.token);
        setUser(response.data.user);
        setIsAuthenticated(true);
        return response.data;
    };

    // Login
    const login = async (email, password) => {
        const response = await api.post('/auth/login', { email, password });
        localStorage.setItem('token', response.data.token);
        setUser(response.data.user);
        setIsAuthenticated(true);
        return response.data;
    };

    // Logout
    const logout = () => {
        localStorage.removeItem('token');
        setUser(null);
        setIsAuthenticated(false);
    };

    // Update user data (e.g., after wallet changes)
    const updateUser = (userData) => {
        setUser(prev => ({ ...prev, ...userData }));
    };

    // Refresh user data from server
    const refreshUser = async () => {
        await loadUser();
    };

    return (
        <AuthContext.Provider value={{
            user,
            loading,
            isAuthenticated,
            register,
            login,
            logout,
            updateUser,
            refreshUser
        }}>
            {children}
        </AuthContext.Provider>
    );
};
