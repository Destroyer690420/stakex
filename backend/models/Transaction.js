const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['credit', 'debit', 'admin_grant', 'admin_deduct', 'game_win', 'game_loss', 'bonus'],
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    metadata: {
        gameType: String,
        sessionId: mongoose.Schema.Types.ObjectId,
        adminId: mongoose.Schema.Types.ObjectId,
        reason: String
    }
}, {
    timestamps: true
});

// Index for efficient queries
transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
