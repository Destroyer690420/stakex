const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { processTransaction } = require('./walletController');

// @desc    Get all users (paginated)
// @route   GET /api/admin/users
exports.getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const query = search ? {
            $or: [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const users = await User.find(query)
            .select('-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            users: users.map(u => u.toPublicProfile()),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
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
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const recentTransactions = await Transaction.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            success: true,
            user: user.toPublicProfile(),
            recentTransactions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get user'
        });
    }
};

// @desc    Assign credits to user
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
            newBalance,
            transaction
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to assign credits'
        });
    }
};

// @desc    Deduct credits from user
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
            newBalance,
            transaction
        });
    } catch (error) {
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
        const user = await User.findById(req.params.id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.isActive = !user.isActive;
        await user.save();

        res.json({
            success: true,
            message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
            isActive: user.isActive
        });
    } catch (error) {
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
        const totalUsers = await User.countDocuments();
        const activeUsers = await User.countDocuments({ isActive: true });

        const walletStats = await User.aggregate([
            {
                $group: {
                    _id: null,
                    totalBalance: { $sum: '$wallet.balance' },
                    avgBalance: { $avg: '$wallet.balance' }
                }
            }
        ]);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const newUsersToday = await User.countDocuments({
            createdAt: { $gte: today }
        });

        res.json({
            success: true,
            stats: {
                totalUsers,
                activeUsers,
                newUsersToday,
                totalCreditsInCirculation: walletStats[0]?.totalBalance || 0,
                averageBalance: Math.round(walletStats[0]?.avgBalance || 0)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get stats'
        });
    }
};
