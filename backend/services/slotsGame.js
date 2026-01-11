// Slots game configuration - Updated with new payout rules
const SYMBOLS = ['🍒', '🍋', '🍊', '🍇', '🔔', '💎', '7️⃣'];

// Payout table for 3 matching symbols
const PAYTABLE = {
    '7️⃣': 20,  // Jackpot
    '💎': 10,  // Diamond
    '🔔': 5,   // Bell
    '🍇': 5,   // Grapes
    '🍊': 5,   // Orange
    '🍋': 5,   // Lemon
    '🍒': 5    // Cherry
};

// Symbol weights (higher = more common)
const SYMBOL_WEIGHTS = {
    '🍒': 28,
    '🍋': 22,
    '🍊': 18,
    '🍇': 15,
    '🔔': 10,
    '💎': 5,
    '7️⃣': 2
};

// Generate a weighted random symbol
const getRandomSymbol = () => {
    const totalWeight = Object.values(SYMBOL_WEIGHTS).reduce((a, b) => a + b, 0);
    let random = Math.random() * totalWeight;

    for (const [symbol, weight] of Object.entries(SYMBOL_WEIGHTS)) {
        random -= weight;
        if (random <= 0) {
            return symbol;
        }
    }
    return SYMBOLS[0];
};

// Generate 3 symbols (single row of reels)
const generateSymbols = () => {
    return [getRandomSymbol(), getRandomSymbol(), getRandomSymbol()];
};

// Calculate multiplier based on symbols
const calculateMultiplier = (symbols) => {
    const [s1, s2, s3] = symbols;

    // All 3 match
    if (s1 === s2 && s2 === s3) {
        return PAYTABLE[s1] || 5;
    }

    // 2 matching
    if (s1 === s2 || s2 === s3 || s1 === s3) {
        return 1.5;
    }

    // No match
    return 0;
};

// Main spin function
const spin = (betAmount) => {
    const symbols = generateSymbols();
    const multiplier = calculateMultiplier(symbols);
    const won = multiplier > 0;
    const payout = won ? Math.round(betAmount * multiplier * 100) / 100 : 0;

    return {
        symbols,
        won,
        multiplier,
        betAmount,
        payout,
        netResult: payout - betAmount
    };
};

module.exports = {
    spin,
    SYMBOLS,
    PAYTABLE,
    SYMBOL_WEIGHTS
};
