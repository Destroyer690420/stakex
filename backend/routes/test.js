const express = require('express');
const router = express.Router();
const TestUser = require('../models/TestUser');

// GET all test users
router.get('/', async (req, res) => {
    try {
        const users = await TestUser.find();
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST create new test user
router.post('/', async (req, res) => {
    try {
        const newUser = new TestUser(req.body);
        await newUser.save();
        res.json(newUser);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
