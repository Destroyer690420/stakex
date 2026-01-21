/**
 * Baccarat (Punto Banco) Game Engine
 * Pure client-side logic - NO network dependencies
 * 
 * Standard Rules:
 * - 8 deck shoe
 * - Card values: 2-9 = face, 10/J/Q/K = 0, A = 1
 * - Score = sum of cards mod 10
 * - Natural: 8 or 9 on first two cards
 */

// Card suits and ranks
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/**
 * Create a standard 8-deck shoe for Baccarat
 */
export function createDeck() {
    const deck = [];
    // 8 decks
    for (let d = 0; d < 8; d++) {
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                deck.push({ suit, rank });
            }
        }
    }
    return deck;
}

/**
 * Fisher-Yates shuffle
 */
export function shuffleDeck(deck) {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Get the numeric value of a card
 * 2-9 = face value
 * 10, J, Q, K = 0
 * A = 1
 */
export function getCardValue(card) {
    if (card.rank === 'A') return 1;
    if (['10', 'J', 'Q', 'K'].includes(card.rank)) return 0;
    return parseInt(card.rank, 10);
}

/**
 * Calculate the score of a hand (sum mod 10)
 */
export function calculateScore(cards) {
    const total = cards.reduce((sum, card) => sum + getCardValue(card), 0);
    return total % 10;
}

/**
 * Check if a hand is a natural (8 or 9)
 */
export function isNatural(cards) {
    if (cards.length !== 2) return false;
    const score = calculateScore(cards);
    return score === 8 || score === 9;
}

/**
 * Determine if the Player should draw a third card
 * Player draws on 0-5, stands on 6-7
 */
export function shouldPlayerDraw(playerScore) {
    return playerScore >= 0 && playerScore <= 5;
}

/**
 * Determine if the Banker should draw a third card
 * This depends on whether the Player drew and what card they got
 * 
 * @param bankerScore - Banker's current score (0-7)
 * @param playerDrew - Whether the player drew a third card
 * @param playerThirdCardValue - The value of the player's third card (if drawn)
 */
export function shouldBankerDraw(bankerScore, playerDrew, playerThirdCardValue = null) {
    // Banker always stands on 7
    if (bankerScore === 7) return false;

    // Banker always draws on 0-2
    if (bankerScore <= 2) return true;

    // If player stood (didn't draw), banker draws on 0-5
    if (!playerDrew) {
        return bankerScore <= 5;
    }

    // Player drew - apply complex rules based on player's third card
    const p3 = playerThirdCardValue;

    switch (bankerScore) {
        case 3:
            // Banker draws unless Player's 3rd card was 8
            return p3 !== 8;
        case 4:
            // Banker draws if Player's 3rd card is 2-7
            return p3 >= 2 && p3 <= 7;
        case 5:
            // Banker draws if Player's 3rd card is 4-7
            return p3 >= 4 && p3 <= 7;
        case 6:
            // Banker draws if Player's 3rd card is 6-7
            return p3 === 6 || p3 === 7;
        default:
            return false;
    }
}

/**
 * Determine the winner of the round
 * @returns 'player' | 'banker' | 'tie'
 */
export function determineWinner(playerScore, bankerScore) {
    if (playerScore > bankerScore) return 'player';
    if (bankerScore > playerScore) return 'banker';
    return 'tie';
}

/**
 * Deal a complete round of Baccarat
 * Returns all cards, scores, and outcome
 */
export function dealRound(deck) {
    // Ensure we have enough cards
    if (deck.length < 6) {
        deck = shuffleDeck(createDeck());
    }

    const remainingDeck = [...deck];
    const playerCards = [];
    const bankerCards = [];

    // Initial deal: Player, Banker, Player, Banker
    playerCards.push(remainingDeck.shift());
    bankerCards.push(remainingDeck.shift());
    playerCards.push(remainingDeck.shift());
    bankerCards.push(remainingDeck.shift());

    let playerScore = calculateScore(playerCards);
    let bankerScore = calculateScore(bankerCards);

    // Check for naturals - game ends immediately
    const playerNatural = isNatural(playerCards);
    const bankerNatural = isNatural(bankerCards);

    let playerDrew = false;
    let playerThirdCardValue = null;

    if (!playerNatural && !bankerNatural) {
        // Player draws first
        if (shouldPlayerDraw(playerScore)) {
            const playerThirdCard = remainingDeck.shift();
            playerCards.push(playerThirdCard);
            playerDrew = true;
            playerThirdCardValue = getCardValue(playerThirdCard);
            playerScore = calculateScore(playerCards);
        }

        // Banker draws based on rules
        bankerScore = calculateScore(bankerCards);
        if (shouldBankerDraw(bankerScore, playerDrew, playerThirdCardValue)) {
            bankerCards.push(remainingDeck.shift());
            bankerScore = calculateScore(bankerCards);
        }
    }

    // Determine winner
    const winner = determineWinner(playerScore, bankerScore);

    return {
        playerCards,
        bankerCards,
        playerScore,
        bankerScore,
        winner,
        playerNatural,
        bankerNatural,
        remainingDeck
    };
}

/**
 * Calculate payout based on bet type and outcome
 * 
 * Payouts:
 * - Player wins: 1:1 (even money)
 * - Banker wins: 0.95:1 (5% commission)
 * - Tie wins: 8:1
 * - Losing bets: 0
 * 
 * @param betAmount - Amount wagered
 * @param winner - 'player' | 'banker' | 'tie'
 * @param betType - 'player' | 'banker' | 'tie'
 * @returns { won: boolean, payout: number, profit: number }
 */
export function calculatePayout(betAmount, winner, betType) {
    if (betAmount <= 0) {
        return { won: false, payout: 0, profit: 0 };
    }

    // Check if the bet won
    if (betType === winner) {
        let multiplier;
        switch (betType) {
            case 'player':
                multiplier = 2; // 1:1 (return bet + winnings)
                break;
            case 'banker':
                multiplier = 1.95; // 0.95:1 (5% commission)
                break;
            case 'tie':
                multiplier = 9; // 8:1 (return bet + 8x winnings)
                break;
            default:
                multiplier = 0;
        }
        const payout = betAmount * multiplier;
        return {
            won: true,
            payout: parseFloat(payout.toFixed(2)),
            profit: parseFloat((payout - betAmount).toFixed(2))
        };
    }

    // Special case: Tie pushes Player/Banker bets (return the bet)
    if (winner === 'tie' && (betType === 'player' || betType === 'banker')) {
        return {
            won: false,
            payout: betAmount, // Push - return the bet
            profit: 0,
            push: true
        };
    }

    // Bet lost
    return {
        won: false,
        payout: 0,
        profit: -betAmount
    };
}

/**
 * Calculate total result for all bets
 */
export function calculateRoundResult(bets, winner) {
    const results = {
        player: calculatePayout(bets.player || 0, winner, 'player'),
        banker: calculatePayout(bets.banker || 0, winner, 'banker'),
        tie: calculatePayout(bets.tie || 0, winner, 'tie')
    };

    const totalBet = (bets.player || 0) + (bets.banker || 0) + (bets.tie || 0);
    const totalPayout = results.player.payout + results.banker.payout + results.tie.payout;
    const totalProfit = totalPayout - totalBet;

    return {
        results,
        totalBet,
        totalPayout,
        totalProfit,
        winner
    };
}

/**
 * Generate animation sequence for card reveals
 * Each card has an 800ms delay between reveals
 */
export function generateAnimationQueue(playerCards, bankerCards) {
    const queue = [];
    const DELAY = 800;

    // Initial 4 cards
    queue.push({ type: 'PLAYER_CARD_1', card: playerCards[0], delay: 0 });
    queue.push({ type: 'BANKER_CARD_1', card: bankerCards[0], delay: DELAY });
    queue.push({ type: 'PLAYER_CARD_2', card: playerCards[1], delay: DELAY * 2 });
    queue.push({ type: 'BANKER_CARD_2', card: bankerCards[1], delay: DELAY * 3 });

    // Third cards if they exist
    if (playerCards[2]) {
        queue.push({ type: 'PLAYER_CARD_3', card: playerCards[2], delay: DELAY * 4 });
    }
    if (bankerCards[2]) {
        const extraDelay = playerCards[2] ? DELAY * 5 : DELAY * 4;
        queue.push({ type: 'BANKER_CARD_3', card: bankerCards[2], delay: extraDelay });
    }

    // Result reveal
    const lastDelay = queue[queue.length - 1].delay;
    queue.push({ type: 'RESULT', delay: lastDelay + DELAY });

    return queue;
}

// Utility: Get display name for card
export function getCardDisplay(card) {
    const suitSymbols = {
        hearts: '♥',
        diamonds: '♦',
        clubs: '♣',
        spades: '♠'
    };
    return `${card.rank}${suitSymbols[card.suit]}`;
}

// Utility: Get card color
export function getCardColor(card) {
    return ['hearts', 'diamonds'].includes(card.suit) ? 'red' : 'black';
}
