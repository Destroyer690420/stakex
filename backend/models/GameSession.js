const mongoose = require('mongoose');

const gameSessionSchema = new mongoose.Schema({
    gameType: {
        type: String,
        enum: ['slots', 'poker', 'roulette'],
        required: true
    },
    players: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        username: String,
        initialChips: Number,
        finalChips: Number,
        profit: Number
    }],
    status: {
        type: String,
        enum: ['waiting', 'active', 'completed', 'cancelled'],
        default: 'active'
    },
    result: {
        type: mongoose.Schema.Types.Mixed // Game-specific result data
    },
    bets: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        amount: Number,
        payout: Number,
        outcome: String
    }],
    startedAt: {
        type: Date,
        default: Date.now
    },
    endedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Index for queries
gameSessionSchema.index({ gameType: 1, status: 1 });
gameSessionSchema.index({ 'players.userId': 1 });

module.exports = mongoose.model('GameSession', gameSessionSchema);
