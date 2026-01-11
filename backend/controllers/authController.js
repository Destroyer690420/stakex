const { supabase, supabaseAdmin } = require('../config/supabase');

// @desc    Register a new user
// @route   POST /api/auth/register
exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Validate input
        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide username, email, and password'
            });
        }

        if (username.length < 3 || username.length > 20) {
            return res.status(400).json({
                success: false,
                message: 'Username must be between 3 and 20 characters'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        // Check if username exists
        const { data: existingUser } = await supabaseAdmin
            .from('users')
            .select('username')
            .eq('username', username)
            .single();

        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Username already taken'
            });
        }

        // Sign up with Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { username }
            }
        });

        if (error) {
            // Handle specific Supabase errors
            if (error.message.includes('already registered')) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already registered'
                });
            }
            return res.status(400).json({
                success: false,
                message: error.message
            });
        }

        // Wait briefly for the trigger to create the user profile
        await new Promise(resolve => setTimeout(resolve, 500));

        // Get the created user profile
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();

        res.status(201).json({
            success: true,
            message: 'Registration successful! Welcome to StakeX!',
            token: data.session?.access_token,
            refreshToken: data.session?.refresh_token,
            user: profile
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Registration failed',
            error: error.message
        });
    }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // Sign in with Supabase Auth
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Update last login
        await supabaseAdmin
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', data.user.id);

        // Get user profile
        const { data: profile } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', data.user.id)
            .single();

        res.json({
            success: true,
            message: 'Login successful',
            token: data.session.access_token,
            refreshToken: data.session.refresh_token,
            user: profile
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message
        });
    }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
exports.getMe = async (req, res) => {
    try {
        // User is already attached by protect middleware
        res.json({
            success: true,
            user: req.user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get user profile'
        });
    }
};

// @desc    Logout user (client-side token removal)
// @route   POST /api/auth/logout
exports.logout = (req, res) => {
    res.json({
        success: true,
        message: 'Logged out successfully'
    });
};

// @desc    Refresh token
// @route   POST /api/auth/refresh
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token required'
            });
        }

        const { data, error } = await supabase.auth.refreshSession({
            refresh_token: refreshToken
        });

        if (error) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token'
            });
        }

        res.json({
            success: true,
            token: data.session.access_token,
            refreshToken: data.session.refresh_token
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Token refresh failed'
        });
    }
};
