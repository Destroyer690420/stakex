// Script to make a user an admin
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function makeAdmin(email) {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found');
            process.exit(1);
        }

        user.isAdmin = true;
        await user.save();
        console.log(`✅ ${user.username} (${email}) is now an admin!`);
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Get email from command line argument
const email = process.argv[2] || 'admin@stakex.com';
makeAdmin(email);
