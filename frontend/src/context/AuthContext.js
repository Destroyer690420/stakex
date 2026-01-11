import React, { createContext, useState, useEffect } from 'react';
import { supabase } from '../services/supabase';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    // Check for existing session on mount and listen for auth changes
    useEffect(() => {
        // Get initial session
        const getSession = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) throw error;

                if (session) {
                    await loadUserProfile(session.user);
                }
            } catch (error) {
                console.error('Session error:', error);
            } finally {
                setLoading(false);
            }
        };

        getSession();

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                console.log('Auth state changed:', event);
                if (session) {
                    await loadUserProfile(session.user);
                } else {
                    setUser(null);
                    setIsAuthenticated(false);
                }
            }
        );

        // Cleanup subscription on unmount
        return () => {
            subscription?.unsubscribe();
        };
    }, []);

    // Load user profile from Supabase users table
    const loadUserProfile = async (authUser) => {
        try {
            const { data: profile, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', authUser.id)
                .single();

            if (error) {
                console.error('Error loading user profile:', error);
                // If no profile exists, use basic auth user data
                setUser({
                    id: authUser.id,
                    email: authUser.email,
                    username: authUser.user_metadata?.username || authUser.email?.split('@')[0],
                    balance: 0,
                    role: 'user'
                });
            } else {
                setUser(profile);
            }
            setIsAuthenticated(true);
        } catch (error) {
            console.error('Load user error:', error);
            setUser(null);
            setIsAuthenticated(false);
        }
    };

    // Register with Supabase Auth
    const register = async (username, email, password) => {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    username: username
                }
            }
        });

        if (error) throw error;

        // Create user profile in users table
        if (data.user) {
            const { error: profileError } = await supabase
                .from('users')
                .insert({
                    id: data.user.id,
                    email: email,
                    username: username,
                    balance: 1000, // Starting balance
                    role: 'user'
                });

            if (profileError) {
                console.error('Error creating user profile:', profileError);
            }

            await loadUserProfile(data.user);
        }

        return data;
    };

    // Login with Supabase Auth
    const login = async (email, password) => {
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) throw error;

        if (data.user) {
            await loadUserProfile(data.user);
        }

        return data;
    };

    // Logout with Supabase Auth
    const logout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) {
            console.error('Logout error:', error);
        }
        setUser(null);
        setIsAuthenticated(false);
    };

    // Update user data (e.g., after wallet changes)
    const updateUser = (userData) => {
        setUser(prev => ({ ...prev, ...userData }));
    };

    // Refresh user data from Supabase
    const refreshUser = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
            await loadUserProfile(session.user);
        }
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
