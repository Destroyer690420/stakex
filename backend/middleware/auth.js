const { supabase, supabaseAdmin } = require('../config/supabase');

// Protect routes - require authentication
exports.protect = async (req, res, next) => {
    try {
        let token;

        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            token = req.headers.authorization.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Not authorized to access this route'
            });
        }

        // Verify token with Supabase
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({
                success: false,
                message: 'Token is invalid or expired'
            });
        }

        // Get user profile from public.users table
        const { data: profile, error: profileError } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileError || !profile) {
            return res.status(401).json({
                success: false,
                message: 'User profile not found'
            });
        }

        if (!profile.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Account has been deactivated'
            });
        }

        // Attach user to request
        req.user = {
            id: user.id,
            email: user.email,
            ...profile
        };

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({
            success: false,
            message: 'Authentication failed'
        });
    }
};

// Admin only middleware
exports.adminOnly = (req, res, next) => {
    if (!req.user.is_admin) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin privileges required.'
        });
    }
    next();
};
