import React, { createContext, useState, useEffect } from 'react';
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

            const response = await api.get('/auth/me');
            setUser(response.data.user);
            setIsAuthenticated(true);
        } catch (error) {
            console.error('Load user error:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            setUser(null);
            setIsAuthenticated(false);
        } finally {
            setLoading(false);
        }
    };

    // Register
    const register = async (username, email, password) => {
        const response = await api.post('/auth/register', { username, email, password });
        if (response.data.token) {
            localStorage.setItem('token', response.data.token);
            if (response.data.refreshToken) {
                localStorage.setItem('refreshToken', response.data.refreshToken);
            }
        }
        setUser(response.data.user);
        setIsAuthenticated(true);
        return response.data;
    };

    // Login
    const login = async (email, password) => {
        const response = await api.post('/auth/login', { email, password });
        localStorage.setItem('token', response.data.token);
        if (response.data.refreshToken) {
            localStorage.setItem('refreshToken', response.data.refreshToken);
        }
        setUser(response.data.user);
        setIsAuthenticated(true);
        return response.data;
    };

    // Logout
    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
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
