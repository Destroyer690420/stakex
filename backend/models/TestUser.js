const mongoose = require('mongoose');

const TestUserSchema = new mongoose.Schema({
    name: String,
    email: String
});

module.exports = mongoose.model('TestUser', TestUserSchema);
