const { supabaseAdmin } = require('../config/supabase');
const { processTransaction } = require('./walletController');

// @desc    Get all users (paginated)
// @route   GET /api/admin/users
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let query = supabaseAdmin
            .from('users')
            .select('id, username, email, cash, is_admin, is_active, stats, created_at, last_login', { count: 'exact' });

        if (search) {
            query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const { data: users, error, count } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            users,
            pagination: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get users'
        });
    }
};

// @desc    Get single user details
// @route   GET /api/admin/users/:id
exports.getUser = async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error || !user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const { data: recentTransactions } = await supabaseAdmin
            .from('transactions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            success: true,
            user,
            recentTransactions: recentTransactions || []
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get user'
        });
    }
};

// @desc    Assign credits (cash) to user
// @route   POST /api/admin/users/:id/credits
exports.assignCredits = async (req, res) => {
    try {
        const { amount, reason } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid positive amount'
            });
        }

        const { transaction, newBalance, user } = await processTransaction(
            req.params.id,
            'admin_grant',
            amount,
            reason || 'Admin credit assignment',
            { adminId: req.user.id, reason }
        );

        res.json({
            success: true,
            message: `Successfully added $${amount} to ${user.username}'s account`,
            newCash: newBalance,
            transaction
        });
    } catch (error) {
        console.error('Assign credits error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to assign credits'
        });
    }
};

// @desc    Deduct credits (cash) from user
// @route   POST /api/admin/users/:id/deduct
exports.deductCredits = async (req, res) => {
    try {
        const { amount, reason } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid positive amount'
            });
        }

        const { transaction, newBalance, user } = await processTransaction(
            req.params.id,
            'admin_deduct',
            amount,
            reason || 'Admin credit deduction',
            { adminId: req.user.id, reason }
        );

        res.json({
            success: true,
            message: `Successfully deducted $${amount} from ${user.username}'s account`,
            newCash: newBalance,
            transaction
        });
    } catch (error) {
        console.error('Deduct credits error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to deduct credits'
        });
    }
};

// @desc    Toggle user active status
// @route   PUT /api/admin/users/:id/status
exports.toggleUserStatus = async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('is_active, username')
            .eq('id', req.params.id)
            .single();

        if (error || !user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const newStatus = !user.is_active;

        const { error: updateError } = await supabaseAdmin
            .from('users')
            .update({ is_active: newStatus, updated_at: new Date().toISOString() })
            .eq('id', req.params.id);

        if (updateError) throw updateError;

        res.json({
            success: true,
            message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
            isActive: newStatus
        });
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status'
        });
    }
};

// @desc    Get admin dashboard stats
// @route   GET /api/admin/stats
exports.getStats = async (req, res) => {
    try {
        // Total users
        const { count: totalUsers } = await supabaseAdmin
            .from('users')
            .select('*', { count: 'exact', head: true });

        // Active users
        const { count: activeUsers } = await supabaseAdmin
            .from('users')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);

        // New users today
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { count: newUsersToday } = await supabaseAdmin
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', today.toISOString());

        // Cash stats
        const { data: cashData } = await supabaseAdmin
            .from('users')
            .select('cash');

        const totalCash = cashData?.reduce((sum, u) => sum + parseFloat(u.cash), 0) || 0;
        const avgCash = cashData?.length ? totalCash / cashData.length : 0;

        res.json({
            success: true,
            stats: {
                totalUsers: totalUsers || 0,
                activeUsers: activeUsers || 0,
                newUsersToday: newUsersToday || 0,
                totalCashInCirculation: totalCash,
                averageCash: Math.round(avgCash)
            }
        });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get stats'
        });
    }
};

// @desc    Adjust credits (supports positive and negative amounts)
// @route   POST /api/admin/credit
exports.adjustCredit = async (req, res) => {
    try {
        const { userId, amount, reason } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'Please provide userId'
            });
        }

        if (amount === undefined || amount === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a non-zero amount'
            });
        }

        const isAddition = amount > 0;
        const absAmount = Math.abs(amount);
        const type = isAddition ? 'admin_grant' : 'admin_deduct';

        const { transaction, newBalance, user } = await processTransaction(
            userId,
            type,
            absAmount,
            reason || `Admin ${isAddition ? 'credit' : 'debit'} adjustment`,
            { adminId: req.user.id, reason }
        );

        res.json({
            success: true,
            message: `Successfully ${isAddition ? 'added' : 'deducted'} $${absAmount} ${isAddition ? 'to' : 'from'} ${user.username}'s account`,
            user: {
                id: user.id,
                username: user.username,
                newCash: newBalance
            },
            transaction
        });
    } catch (error) {
        console.error('Adjust credit error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to adjust credits'
        });
    }
};

// @desc    Bulk credit adjustment (multiple users or all)
// @route   POST /api/admin/bulkcredit
exports.bulkCredit = async (req, res) => {
    try {
        const { userIds, amount, reason } = req.body;

        if (amount === undefined || amount === 0) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a non-zero amount'
            });
        }

        if (!userIds) {
            return res.status(400).json({
                success: false,
                message: 'Please provide userIds array or "all"'
            });
        }

        let targetUsers;

        if (userIds === 'all') {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, username, cash')
                .eq('is_active', true);
            targetUsers = data;
        } else if (Array.isArray(userIds)) {
            const { data } = await supabaseAdmin
                .from('users')
                .select('id, username, cash')
                .in('id', userIds);
            targetUsers = data;
        } else {
            return res.status(400).json({
                success: false,
                message: 'userIds must be an array or "all"'
            });
        }

        if (!targetUsers || targetUsers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No users found'
            });
        }

        const isAddition = amount > 0;
        const absAmount = Math.abs(amount);
        const type = isAddition ? 'admin_grant' : 'admin_deduct';

        const results = [];
        const errors = [];

        for (const user of targetUsers) {
            try {
                if (!isAddition && parseFloat(user.cash) < absAmount) {
                    errors.push({
                        userId: user.id,
                        username: user.username,
                        error: `Insufficient balance ($${user.cash})`
                    });
                    continue;
                }

                const { newBalance } = await processTransaction(
                    user.id,
                    type,
                    absAmount,
                    reason || `Bulk admin ${isAddition ? 'credit' : 'debit'}`,
                    { adminId: req.user.id, reason, bulkOperation: true }
                );

                results.push({
                    userId: user.id,
                    username: user.username,
                    newCash: newBalance
                });
            } catch (err) {
                errors.push({
                    userId: user.id,
                    username: user.username,
                    error: err.message
                });
            }
        }

        res.json({
            success: true,
            message: `Bulk operation completed. ${results.length} users updated, ${errors.length} errors.`,
            amount: isAddition ? absAmount : -absAmount,
            updated: results,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Bulk credit error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to process bulk credits'
        });
    }
};
