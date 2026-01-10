const express = require('express');
const router = express.Router();
const { getBalance, getTransactions } = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.get('/balance', protect, getBalance);
router.get('/transactions', protect, getTransactions);

module.exports = router;
