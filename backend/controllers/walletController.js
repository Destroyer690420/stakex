const User = require('../models/User');
const Transaction = require('../models/Transaction');

// @desc    Get wallet balance
// @route   GET /api/wallet/balance
exports.getBalance = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({
            success: true,
            wallet: user.wallet
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get wallet balance'
        });
    }
};

// @desc    Get transaction history
// @route   GET /api/wallet/transactions
exports.getTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const transactions = await Transaction.find({ userId: req.user.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Transaction.countDocuments({ userId: req.user.id });

        res.json({
            success: true,
            transactions,
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
            message: 'Failed to get transactions'
        });
    }
};

// Internal function to process wallet transactions
exports.processTransaction = async (userId, type, amount, description, metadata = {}) => {
    const user = await User.findById(userId);

    if (!user) {
        throw new Error('User not found');
    }

    // Calculate new balance
    let newBalance = user.wallet.balance;

    if (['credit', 'admin_grant', 'game_win', 'bonus'].includes(type)) {
        newBalance += amount;
        if (type === 'game_win') {
            user.wallet.lifetimeEarnings += amount;
            if (amount > user.stats.biggestWin) {
                user.stats.biggestWin = amount;
            }
        }
    } else if (['debit', 'admin_deduct', 'game_loss'].includes(type)) {
        if (user.wallet.balance < amount) {
            throw new Error('Insufficient balance');
        }
        newBalance -= amount;
        if (type === 'game_loss') {
            user.wallet.lifetimeLosses += amount;
        }
    }

    // Update user balance
    user.wallet.balance = newBalance;
    await user.save();

    // Create transaction record
    const transaction = await Transaction.create({
        userId,
        type,
        amount,
        balanceAfter: newBalance,
        description,
        metadata
    });

    return { transaction, newBalance, user };
};
