import React, { useContext } from 'react';
import { AuthContext } from '../../context/AuthContext';
import useBaccarat from '../../hooks/useBaccarat';
import { getCardDisplay, getCardColor } from '../../lib/baccaratEngine';
import './Baccarat.css';

/**
 * Baccarat Game Component
 * 
 * High-fidelity Punto Banco implementation
 * Core bets: Player (1:1), Banker (0.95:1), Tie (8:1)
 */
const Baccarat = () => {
    const { user } = useContext(AuthContext);

    const {
        gameState,
        bets,
        selectedChip,
        playerCards,
        bankerCards,
        playerScore,
        bankerScore,
        winner,
        roundResult,
        isAnimating,
        isProcessing,
        totalBet,
        canDeal,
        canClear,
        canRebet,
        placeBet,
        removeBet,
        clearBets,
        rebet,
        setSelectedChip,
        deal,
        newRound,
        CHIP_VALUES
    } = useBaccarat();

    // Handle zone click
    const handleZoneClick = (zone) => {
        if (gameState !== 'betting' || isProcessing) return;
        placeBet(zone);
    };

    // Handle zone right-click (remove bet)
    const handleZoneRightClick = (e, zone) => {
        e.preventDefault();
        if (gameState !== 'betting' || isProcessing) return;
        removeBet(zone);
    };

    // Render a playing card
    const renderCard = (card, index) => {
        if (!card) return null;
        const color = getCardColor(card);
        const display = getCardDisplay(card);

        return (
            <div
                key={index}
                className={`baccarat-card ${color}`}
                style={{ animationDelay: `${index * 100}ms` }}
            >
                <span className="card-rank">{card.rank}</span>
                <span className="card-suit">
                    {card.suit === 'hearts' && '♥'}
                    {card.suit === 'diamonds' && '♦'}
                    {card.suit === 'clubs' && '♣'}
                    {card.suit === 'spades' && '♠'}
                </span>
            </div>
        );
    };

    // Render card placeholders
    const renderCardPlaceholders = (count = 2) => {
        return Array.from({ length: count }).map((_, i) => (
            <div key={i} className="card-placeholder" />
        ));
    };

    // Calculate bet percentage for display
    const getBetPercentage = (zone) => {
        if (totalBet === 0) return 0;
        return Math.round((bets[zone] / totalBet) * 100);
    };

    return (
        <div className="baccarat-wrapper">
            <div className="baccarat-container">
                {/* Balance Display */}
                <div className="baccarat-balance">
                    <div className="balance-item">
                        <span className="balance-label">Balance</span>
                        <span className="balance-value">${(user?.cash || 0).toFixed(2)}</span>
                    </div>
                    <div className="balance-item">
                        <span className="balance-label">Total Bet</span>
                        <span className="balance-value">${totalBet.toFixed(2)}</span>
                    </div>
                </div>

                {/* Scoreboard */}
                <div className="baccarat-scoreboard">
                    <div className={`score-bubble player ${gameState === 'result' && winner === 'player' ? 'highlight' : ''}`}>
                        {gameState !== 'betting' ? playerScore : '-'}
                    </div>
                    <div className={`score-bubble banker ${gameState === 'result' && winner === 'banker' ? 'highlight' : ''}`}>
                        {gameState !== 'betting' ? bankerScore : '-'}
                    </div>
                </div>

                {/* Game Table */}
                <div className="baccarat-table">
                    <div className="baccarat-betting-area">
                        {/* Player Zone */}
                        <div
                            className={`bet-zone player-zone ${gameState !== 'betting' ? 'disabled' : ''} ${winner === 'player' ? 'winner' : ''}`}
                            onClick={() => handleZoneClick('player')}
                            onContextMenu={(e) => handleZoneRightClick(e, 'player')}
                        >
                            <div className="zone-bet-info">
                                {bets.player > 0 && (
                                    <div className="bet-percentage">{getBetPercentage('player')}%</div>
                                )}
                            </div>

                            <div className="zone-cards">
                                {playerCards.length > 0
                                    ? playerCards.map((card, i) => renderCard(card, i))
                                    : renderCardPlaceholders(2)
                                }
                            </div>

                            <div className="zone-label">Player</div>
                            <div className="zone-odds">1:1</div>

                            {bets.player > 0 && (
                                <div className="zone-bet-amount">${bets.player}</div>
                            )}
                        </div>

                        {/* Tie Zone */}
                        <div
                            className={`bet-zone tie-zone ${gameState !== 'betting' ? 'disabled' : ''} ${winner === 'tie' ? 'winner' : ''}`}
                            onClick={() => handleZoneClick('tie')}
                            onContextMenu={(e) => handleZoneRightClick(e, 'tie')}
                        >
                            <div className="zone-bet-info">
                                {bets.tie > 0 && (
                                    <div className="bet-percentage">{getBetPercentage('tie')}%</div>
                                )}
                            </div>

                            <div className="zone-label">Tie</div>
                            <div className="zone-odds">8:1</div>

                            {bets.tie > 0 && (
                                <div className="zone-bet-amount">${bets.tie}</div>
                            )}
                        </div>

                        {/* Banker Zone */}
                        <div
                            className={`bet-zone banker-zone ${gameState !== 'betting' ? 'disabled' : ''} ${winner === 'banker' ? 'winner' : ''}`}
                            onClick={() => handleZoneClick('banker')}
                            onContextMenu={(e) => handleZoneRightClick(e, 'banker')}
                        >
                            <div className="zone-bet-info">
                                {bets.banker > 0 && (
                                    <div className="bet-percentage">{getBetPercentage('banker')}%</div>
                                )}
                            </div>

                            <div className="zone-cards">
                                {bankerCards.length > 0
                                    ? bankerCards.map((card, i) => renderCard(card, i))
                                    : renderCardPlaceholders(2)
                                }
                            </div>

                            <div className="zone-label">Banker</div>
                            <div className="zone-odds">0.95:1</div>

                            {bets.banker > 0 && (
                                <div className="zone-bet-amount">${bets.banker}</div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Control Bar */}
                <div className="baccarat-controls">
                    {/* Chip Selector */}
                    <div className="chip-selector">
                        {CHIP_VALUES.map(value => (
                            <div
                                key={value}
                                className={`chip ${selectedChip === value ? 'selected' : ''}`}
                                data-value={value}
                                onClick={() => setSelectedChip(value)}
                            >
                                ${value}
                            </div>
                        ))}
                    </div>

                    {/* Action Buttons */}
                    <div className="action-buttons">
                        {gameState === 'betting' && (
                            <>
                                <button
                                    className="action-btn clear-btn"
                                    onClick={clearBets}
                                    disabled={!canClear || isProcessing}
                                >
                                    Clear
                                </button>

                                <button
                                    className="action-btn rebet-btn"
                                    onClick={rebet}
                                    disabled={!canRebet || isProcessing}
                                >
                                    Rebet
                                </button>

                                <button
                                    className="action-btn deal-btn"
                                    onClick={deal}
                                    disabled={!canDeal || isProcessing}
                                >
                                    {isProcessing ? (
                                        <span className="baccarat-spinner" />
                                    ) : (
                                        'Deal'
                                    )}
                                </button>
                            </>
                        )}

                        {gameState === 'dealing' && (
                            <button className="action-btn deal-btn" disabled>
                                <span className="baccarat-spinner" />
                            </button>
                        )}

                        {gameState === 'result' && !isAnimating && (
                            <button
                                className="action-btn new-round-btn"
                                onClick={newRound}
                                disabled={isProcessing}
                            >
                                New Round
                            </button>
                        )}
                    </div>
                </div>

                {/* Result Overlay */}
                {gameState === 'result' && !isAnimating && roundResult && (
                    <div className="result-overlay" onClick={newRound}>
                        <div className="result-modal" onClick={e => e.stopPropagation()}>
                            <div className={`result-winner ${winner}`}>
                                {winner === 'tie' ? 'TIE!' : `${winner.toUpperCase()} WINS!`}
                            </div>

                            <div className="result-scores">
                                <div className="result-score">
                                    <div className="result-score-label">Player</div>
                                    <div className="result-score-value">{playerScore}</div>
                                </div>
                                <div className="result-score">
                                    <div className="result-score-label">Banker</div>
                                    <div className="result-score-value">{bankerScore}</div>
                                </div>
                            </div>

                            <div className={`result-profit ${roundResult.totalProfit > 0 ? 'win' :
                                    roundResult.totalProfit < 0 ? 'loss' : 'push'
                                }`}>
                                {roundResult.totalProfit > 0 && `+$${roundResult.totalProfit.toFixed(2)}`}
                                {roundResult.totalProfit < 0 && `-$${Math.abs(roundResult.totalProfit).toFixed(2)}`}
                                {roundResult.totalProfit === 0 && 'Push - Bets Returned'}
                            </div>

                            <button
                                className="action-btn new-round-btn"
                                onClick={newRound}
                            >
                                New Round
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Baccarat;
