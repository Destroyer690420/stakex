const { supabaseAdmin } = require('../config/supabase');

// @desc    Get wallet balance (cash)
// @route   GET /api/wallet/balance
exports.getBalance = async (req, res) => {
    try {
        const { data: user, error } = await supabaseAdmin
            .from('users')
            .select('cash, stats')
            .eq('id', req.user.id)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            cash: parseFloat(user.cash),
            stats: user.stats
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
        const offset = (page - 1) * limit;

        const { data: transactions, error, count } = await supabaseAdmin
            .from('transactions')
            .select('*', { count: 'exact' })
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({
            success: true,
            transactions,
            pagination: {
                page,
                limit,
                total: count,
                pages: Math.ceil(count / limit)
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get transactions'
        });
    }
};

// Internal function to process wallet transactions (used by games and admin)
exports.processTransaction = async (userId, type, amount, description, metadata = {}) => {
    const { data, error } = await supabaseAdmin.rpc('process_transaction', {
        p_user_id: userId,
        p_type: type,
        p_amount: amount,
        p_description: description,
        p_metadata: metadata
    });

    if (error) {
        throw new Error(error.message);
    }

    // Get updated user
    const { data: user } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    return {
        transaction: { id: data[0].transaction_id },
        newBalance: parseFloat(data[0].new_balance),
        user
    };
};
