// Slots game configuration
const SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣', '⭐'];

const PAYTABLE = {
    '🍒🍒🍒': 3,
    '🍋🍋🍋': 4,
    '🍇🍇🍇': 5,
    '🔔🔔🔔': 8,
    '💎💎💎': 10,
    '⭐⭐⭐': 15,
    '7️⃣7️⃣7️⃣': 50
};

// Symbol weights (higher = more common)
const SYMBOL_WEIGHTS = {
    '🍒': 20,
    '🍋': 18,
    '🍇': 15,
    '🔔': 12,
    '💎': 8,
    '⭐': 5,
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

// Generate a 3x3 grid
const generateGrid = () => {
    const grid = [];
    for (let row = 0; row < 3; row++) {
        grid.push([]);
        for (let col = 0; col < 3; col++) {
            grid[row].push(getRandomSymbol());
        }
    }
    return grid;
};

// Check for wins (middle row only for MVP)
const checkWin = (grid) => {
    const middleRow = grid[1].join('');

    if (PAYTABLE[middleRow]) {
        return {
            won: true,
            multiplier: PAYTABLE[middleRow],
            winLine: grid[1]
        };
    }

    return {
        won: false,
        multiplier: 0,
        winLine: null
    };
};

// Main spin function
const spin = (betAmount) => {
    const grid = generateGrid();
    const result = checkWin(grid);
    const payout = result.won ? betAmount * result.multiplier : 0;

    return {
        grid,
        won: result.won,
        multiplier: result.multiplier,
        winLine: result.winLine,
        betAmount,
        payout,
        netResult: payout - betAmount
    };
};

module.exports = {
    spin,
    SYMBOLS,
    PAYTABLE
};
