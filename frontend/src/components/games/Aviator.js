import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import './Aviator.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// Plane SVG component
const PlaneIcon = ({ style }) => (
    <svg style={style} viewBox="0 0 100 50" fill="currentColor">
        <path d="M95 25 L75 15 L20 20 L5 10 L5 15 L15 22 L5 22 L5 28 L15 28 L5 35 L5 40 L20 30 L75 35 L95 25Z" />
        <ellipse cx="65" cy="25" rx="8" ry="4" fill="rgba(255,255,255,0.3)" />
    </svg>
);

const Aviator = () => {
    const { user, updateUser } = useContext(AuthContext);
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    const animationRef = useRef(null);

    // Use refs for smooth animation (no re-renders)
    const gameStateRef = useRef({
        phase: 'connecting',
        targetMultiplier: 1.00,
        displayMultiplier: 1.00,
        crashPoint: null,
        startTime: null
    });

    const planeRef = useRef(null);
    const multiplierDisplayRef = useRef(null);

    // React state only for things that need re-renders
    const [gamePhase, setGamePhase] = useState('connecting');
    const [countdown, setCountdown] = useState(5);
    const [roundId, setRoundId] = useState(null);
    const [history, setHistory] = useState([]);
    const [liveBets, setLiveBets] = useState([]);

    // Bet states
    const [bet1Amount, setBet1Amount] = useState('10.00');
    const [bet1Auto, setBet1Auto] = useState('');
    const [bet1Active, setBet1Active] = useState(false);
    const [bet1CashedOut, setBet1CashedOut] = useState(false);

    const [bet2Amount, setBet2Amount] = useState('10.00');
    const [bet2Auto, setBet2Auto] = useState('');
    const [bet2Active, setBet2Active] = useState(false);
    const [bet2CashedOut, setBet2CashedOut] = useState(false);

    // Draw the game - uses refs, no state dependencies
    const drawGame = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const state = gameStateRef.current;
        const isCrashed = state.phase === 'crashed';
        const mult = state.displayMultiplier;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw sunburst background from top-right
        const centerX = width;
        const centerY = 0;
        const numRays = 24;
        const rayAngle = Math.PI / numRays;

        for (let i = 0; i < numRays * 2; i++) {
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            const angle1 = i * rayAngle - Math.PI / 2;
            const angle2 = (i + 1) * rayAngle - Math.PI / 2;
            const radius = Math.max(width, height) * 2;
            ctx.lineTo(centerX + Math.cos(angle1) * radius, centerY + Math.sin(angle1) * radius);
            ctx.lineTo(centerX + Math.cos(angle2) * radius, centerY + Math.sin(angle2) * radius);
            ctx.closePath();
            ctx.fillStyle = i % 2 === 0 ? '#1a1a1a' : '#121212';
            ctx.fill();
        }

        // Draw subtle grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.lineWidth = 1;
        const gridSize = 30;
        for (let x = 0; x < width; x += gridSize) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y < height; y += gridSize) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Hide plane during waiting
        if (mult <= 1.01 || state.phase === 'waiting') {
            if (planeRef.current) {
                planeRef.current.style.opacity = '0';
            }
            return;
        }

        // === CURVE DRAWING LOGIC ===
        // The key insight: the MULTIPLIER determines how much curve we've drawn
        // At mult=1.00, we're at the start. As mult increases, more curve is revealed.

        const padding = { left: 15, bottom: 15, top: 25, right: 40 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;

        // Calculate "virtual time" from multiplier
        // Using formula: mult = e^(k * t), so t = ln(mult) / k
        const k = 0.08; // Controls curve steepness
        const virtualTime = Math.log(mult) / k;

        // Dynamic view scaling - always show curve with room to grow
        // The max view adapts so current position is at ~70% of the viewable area
        const maxMultForView = Math.max(mult * 1.5, 2.0);
        const maxTimeForView = Math.log(maxMultForView) / k;

        // Generate the curve points from t=0 to t=current
        const curvePoints = [];
        const numPoints = 80;

        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * virtualTime;
            const m = Math.exp(k * t); // Multiplier at this point in time

            // Map to canvas coordinates
            // X: time progresses left to right
            const xProgress = t / maxTimeForView;
            const x = padding.left + xProgress * graphWidth;

            // Y: multiplier value mapped to height (1.0 at bottom, maxMult at top)
            const yProgress = (m - 1) / (maxMultForView - 1);
            const y = height - padding.bottom - yProgress * graphHeight;

            curvePoints.push({ x, y, mult: m });
        }

        // Draw the filled area under the curve
        ctx.beginPath();
        ctx.moveTo(padding.left, height - padding.bottom); // Start at origin (1.00x)

        curvePoints.forEach(point => {
            ctx.lineTo(point.x, point.y);
        });

        // Close the shape back to the x-axis
        const tipPoint = curvePoints[curvePoints.length - 1];
        ctx.lineTo(tipPoint.x, height - padding.bottom);
        ctx.closePath();

        // Fill with gradient
        const gradient = ctx.createLinearGradient(0, height, 0, 0);
        if (isCrashed) {
            gradient.addColorStop(0, 'rgba(139, 0, 0, 0.8)');
            gradient.addColorStop(0.5, 'rgba(180, 30, 30, 0.5)');
            gradient.addColorStop(1, 'rgba(220, 20, 60, 0.2)');
        } else {
            gradient.addColorStop(0, 'rgba(139, 0, 0, 0.95)');
            gradient.addColorStop(0.3, 'rgba(178, 34, 34, 0.7)');
            gradient.addColorStop(0.7, 'rgba(200, 50, 60, 0.4)');
            gradient.addColorStop(1, 'rgba(220, 53, 69, 0.1)');
        }
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw the curve line with glow effect
        ctx.shadowColor = isCrashed ? '#ff4757' : '#ff3344';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(curvePoints[0].x, curvePoints[0].y);

        // Use quadratic curves for smoother line
        for (let i = 1; i < curvePoints.length; i++) {
            const current = curvePoints[i];
            const prev = curvePoints[i - 1];
            const midX = (prev.x + current.x) / 2;
            const midY = (prev.y + current.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
        ctx.lineTo(tipPoint.x, tipPoint.y);

        ctx.strokeStyle = isCrashed ? '#ff4757' : '#dc3545';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw a glowing dot at the curve tip
        if (!isCrashed) {
            ctx.beginPath();
            ctx.arc(tipPoint.x, tipPoint.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.shadowColor = '#ff3344';
            ctx.shadowBlur = 15;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // === PLANE POSITIONING ===
        // Position the plane exactly at the tip of the curve
        if (planeRef.current && curvePoints.length > 5) {
            // Get the last few points to calculate direction
            const prevPoint = curvePoints[curvePoints.length - 6];

            // Calculate flight angle (direction the curve is going)
            const dx = tipPoint.x - prevPoint.x;
            const dy = tipPoint.y - prevPoint.y;
            const angleRad = Math.atan2(dy, dx);
            const angleDeg = angleRad * (180 / Math.PI);

            // Plane position: at the tip, slightly offset in flight direction
            const offsetX = Math.cos(angleRad) * 15;
            const offsetY = Math.sin(angleRad) * 15;

            planeRef.current.style.left = `${tipPoint.x + offsetX}px`;
            planeRef.current.style.top = `${tipPoint.y + offsetY}px`;
            planeRef.current.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
            planeRef.current.style.opacity = isCrashed ? '0' : '1';
        }

        // Update the multiplier text display
        if (multiplierDisplayRef.current) {
            multiplierDisplayRef.current.textContent = `${mult.toFixed(2)}x`;
        }
    }, []);

    // Main animation loop - runs at 60fps
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resize = () => {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
        };

        resize();
        window.addEventListener('resize', resize);

        let lastTime = 0;

        const animate = (currentTime) => {
            const deltaTime = currentTime - lastTime;
            lastTime = currentTime;

            const state = gameStateRef.current;

            // Smooth interpolation towards target multiplier
            if (state.phase === 'flying') {
                const lerpFactor = Math.min(1, deltaTime * 0.008); // Smooth lerp
                state.displayMultiplier += (state.targetMultiplier - state.displayMultiplier) * lerpFactor;
            } else if (state.phase === 'crashed') {
                state.displayMultiplier = state.crashPoint || state.targetMultiplier;
            } else {
                state.displayMultiplier = 1.00;
            }

            drawGame();
            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);

        return () => {
            window.removeEventListener('resize', resize);
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [drawGame]);

    // Socket connection
    useEffect(() => {
        socketRef.current = io(SOCKET_URL);

        socketRef.current.emit('join_aviator');

        socketRef.current.on('game_state', (data) => {
            console.log('[Aviator] game_state received:', data.phase, data.roundId);
            gameStateRef.current.phase = data.phase;
            setGamePhase(data.phase);

            // Only reset bet states when a NEW round starts (different roundId)
            if (data.phase === 'waiting') {
                setRoundId(prevRoundId => {
                    // Only reset if this is a different round
                    if (prevRoundId !== data.roundId) {
                        console.log('[Aviator] New round, resetting bet states');
                        gameStateRef.current.targetMultiplier = 1.00;
                        gameStateRef.current.displayMultiplier = 1.00;
                        gameStateRef.current.crashPoint = null;
                        setBet1CashedOut(false);
                        setBet2CashedOut(false);
                        setBet1Active(false);
                        setBet2Active(false);
                        setCountdown(Math.ceil((data.countdown || 5000) / 1000));
                        setLiveBets([]);
                    }
                    return data.roundId;
                });
            } else {
                setRoundId(data.roundId);
                if (data.phase === 'crashed') {
                    gameStateRef.current.crashPoint = data.crashPoint;
                    gameStateRef.current.targetMultiplier = data.crashPoint;
                } else if (data.phase === 'flying') {
                    if (data.multiplier) {
                        gameStateRef.current.targetMultiplier = data.multiplier;
                    }
                }
            }
        });

        socketRef.current.on('tick', (data) => {
            gameStateRef.current.targetMultiplier = data.multiplier;
            gameStateRef.current.phase = 'flying';
            // Also update React state to ensure buttons update
            setGamePhase(prev => {
                if (prev !== 'flying') {
                    console.log('[Aviator] tick updating phase to flying');
                    return 'flying';
                }
                return prev;
            });
        });

        socketRef.current.on('history', (data) => {
            setHistory(data || []);
        });

        socketRef.current.on('round_bets', (data) => {
            setLiveBets(data || []);
        });

        socketRef.current.on('new_bet', (data) => {
            setLiveBets(prev => [data, ...prev].slice(0, 20));
        });

        socketRef.current.on('player_cashout', (data) => {
            setLiveBets(prev => prev.map(b =>
                b.username === data.username ? { ...b, cashout: data.multiplier } : b
            ));
        });

        socketRef.current.on('bet_result', (data) => {
            console.log('[Aviator] bet_result received:', data);
            const betNum = Number(data.betNumber);
            if (data.success) {
                toast.success('Bet placed!');
                if (data.new_balance !== undefined) {
                    updateUser({ cash: data.new_balance });
                }
                // Set active state on successful bet
                console.log('[Aviator] Setting bet', betNum, 'active = true');
                if (betNum === 1) {
                    setBet1Active(true);
                } else if (betNum === 2) {
                    setBet2Active(true);
                }
            } else {
                toast.error(data.error || 'Bet failed');
                // Reset active state on failed bet
                console.log('[Aviator] Bet failed, setting bet', betNum, 'active = false');
                if (betNum === 1) {
                    setBet1Active(false);
                } else if (betNum === 2) {
                    setBet2Active(false);
                }
            }
        });

        socketRef.current.on('cashout_result', (data) => {
            if (data.success) {
                toast.success(`Cashed out at ${data.multiplier.toFixed(2)}x! +$${data.profit.toFixed(2)}`);
                refreshBalance();
            } else {
                toast.error(data.error || 'Cash out failed');
            }
        });

        return () => {
            socketRef.current?.emit('leave_aviator');
            socketRef.current?.disconnect();
        };
    }, [updateUser]);

    // Countdown timer
    useEffect(() => {
        if (gamePhase === 'waiting' && countdown > 0) {
            const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [gamePhase, countdown]);

    const refreshBalance = async () => {
        if (!user?.id) return;
        const { data } = await supabase
            .from('users')
            .select('cash')
            .eq('id', user.id)
            .single();
        if (data) updateUser({ cash: data.cash });
    };

    const placeBet = (betNumber) => {
        if (!user?.id || !roundId) return;
        if (gamePhase !== 'waiting') {
            toast.error('Round already started');
            return;
        }

        const amount = parseFloat(betNumber === 1 ? bet1Amount : bet2Amount);
        const auto = parseFloat(betNumber === 1 ? bet1Auto : bet2Auto);

        if (isNaN(amount) || amount <= 0) {
            toast.error('Invalid bet amount');
            return;
        }

        // Show pending state (button will be disabled)
        if (betNumber === 1) setBet1Active('pending');
        else setBet2Active('pending');

        socketRef.current?.emit('place_bet', {
            userId: user.id,
            amount,
            betNumber,
            autoCashout: isNaN(auto) ? null : auto
        });
    };

    const cashOut = (betNumber) => {
        if (!user?.id) return;

        const currentMult = gameStateRef.current.displayMultiplier;

        socketRef.current?.emit('cash_out', {
            userId: user.id,
            betNumber,
            clientMultiplier: currentMult
        });

        if (betNumber === 1) setBet1CashedOut(true);
        else setBet2CashedOut(true);
    };

    const renderBetPanel = (betNum) => {
        const amount = betNum === 1 ? bet1Amount : bet2Amount;
        const setAmount = betNum === 1 ? setBet1Amount : setBet2Amount;
        const auto = betNum === 1 ? bet1Auto : bet2Auto;
        const setAuto = betNum === 1 ? setBet1Auto : setBet2Auto;
        const active = betNum === 1 ? bet1Active : bet2Active;
        const cashedOut = betNum === 1 ? bet1CashedOut : bet2CashedOut;

        const isPending = active === 'pending';
        const isActive = active === true;
        const canBet = gamePhase === 'waiting' && !active;
        const canCashout = gamePhase === 'flying' && isActive && !cashedOut;

        return (
            <div className="bet-panel">
                <div className="bet-inputs">
                    <div className="input-group">
                        <label>Bet Amount</label>
                        <div className="amount-input">
                            <span className="currency">$</span>
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                disabled={active}
                                min="0.01"
                                step="0.01"
                            />
                        </div>
                    </div>

                    <div className="input-group">
                        <label>Auto Cashout</label>
                        <div className="amount-input">
                            <input
                                type="number"
                                value={auto}
                                onChange={(e) => setAuto(e.target.value)}
                                placeholder="Off"
                                disabled={active}
                                min="1.01"
                                step="0.01"
                            />
                            <span className="suffix">x</span>
                        </div>
                    </div>
                </div>

                {canBet && (
                    <button className="bet-btn" onClick={() => placeBet(betNum)}>
                        BET
                    </button>
                )}

                {isPending && (
                    <button className="waiting-btn" disabled>
                        PLACING BET...
                    </button>
                )}

                {canCashout && (
                    <button className="cashout-btn" onClick={() => cashOut(betNum)}>
                        CASH OUT
                    </button>
                )}

                {isActive && cashedOut && (
                    <button className="cashed-btn" disabled>
                        CASHED OUT ✓
                    </button>
                )}

                {gamePhase === 'crashed' && isActive && !cashedOut && (
                    <button className="lost-btn" disabled>
                        LOST
                    </button>
                )}

                {gamePhase === 'flying' && !isActive && !isPending && (
                    <button className="waiting-btn" disabled>
                        WAITING...
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="aviator-wrapper">
            <div className="aviator-container">
                {/* Header with history */}
                <div className="aviator-header">
                    <h1>✈️ Aviator</h1>
                    <div className="crash-history">
                        {history.slice(0, 15).map((h, i) => (
                            <span
                                key={h.id || i}
                                className={`history-item ${parseFloat(h.crash_point) >= 2 ? 'high' : 'low'}`}
                            >
                                {parseFloat(h.crash_point).toFixed(2)}x
                            </span>
                        ))}
                    </div>
                </div>

                <div className="aviator-main">
                    {/* Game Canvas */}
                    <div className="game-area">
                        <canvas ref={canvasRef} className="game-canvas" />

                        {/* Plane overlay - positioned via ref */}
                        <div
                            ref={planeRef}
                            className="plane-container"
                            style={{ opacity: 0 }}
                        >
                            <PlaneIcon style={{ width: '100%', height: '100%', color: '#dc3545' }} />
                        </div>

                        {/* Multiplier Display */}
                        <div className="multiplier-overlay">
                            {gamePhase === 'waiting' && (
                                <div className="waiting-display">
                                    <div className="waiting-text">STARTING IN</div>
                                    <div className="countdown-number">{countdown}</div>
                                </div>
                            )}

                            {gamePhase === 'flying' && (
                                <div
                                    ref={multiplierDisplayRef}
                                    className="flying-multiplier"
                                >
                                    1.00x
                                </div>
                            )}

                            {gamePhase === 'crashed' && (
                                <div className="crashed-display">
                                    <div className="flew-away">FLEW AWAY!</div>
                                    <div className="crash-multiplier">
                                        {gameStateRef.current.crashPoint?.toFixed(2)}x
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Betting Panels - Before Live Bets for mobile */}
                    <div className="betting-area">
                        {renderBetPanel(1)}
                        {renderBetPanel(2)}
                    </div>

                    {/* Live Bets - At bottom for mobile */}
                    <div className="live-bets">
                        <div className="bets-header">
                            <span>All Bets</span>
                            <span className="bet-count">{liveBets.length}</span>
                        </div>
                        <div className="bets-list">
                            {liveBets.map((bet, i) => (
                                <div key={i} className={`bet-item ${bet.cashout ? 'cashed' : ''}`}>
                                    <span className="bet-user">{bet.username || bet.users?.username}</span>
                                    <span className="bet-amount">${parseFloat(bet.amount || 0).toFixed(2)}</span>
                                    {bet.cashout ? (
                                        <span className="bet-cashout">{parseFloat(bet.cashout).toFixed(2)}x</span>
                                    ) : (
                                        <span className="bet-waiting">-</span>
                                    )}
                                </div>
                            ))}
                            {liveBets.length === 0 && (
                                <div className="no-bets">No bets yet</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Aviator;

