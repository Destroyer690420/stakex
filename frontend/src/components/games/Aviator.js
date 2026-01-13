import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { supabase } from '../../services/supabase';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import './Aviator.css';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

// Explosion particle component
const ExplosionEffect = ({ x, y, active }) => {
    if (!active) return null;

    return (
        <div className="explosion-container" style={{ left: x, top: y }}>
            {/* Central flash */}
            <div className="explosion-flash" />

            {/* Debris particles */}
            {[...Array(12)].map((_, i) => (
                <div key={i} className={`debris debris-${i}`} />
            ))}

            {/* Smoke clouds */}
            <div className="smoke-cloud smoke-1" />
            <div className="smoke-cloud smoke-2" />
            <div className="smoke-cloud smoke-3" />

            {/* Fire particles */}
            {[...Array(8)].map((_, i) => (
                <div key={`fire-${i}`} className={`fire-particle fire-${i}`} />
            ))}
        </div>
    );
};

const Aviator = () => {
    const { user, updateUser } = useContext(AuthContext);
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    const animationRef = useRef(null);
    const planeImageRef = useRef(null);

    // Use refs for smooth animation (no re-renders)
    const gameStateRef = useRef({
        phase: 'connecting',
        targetMultiplier: 1.00,
        displayMultiplier: 1.00,
        crashPoint: null,
        startTime: null,
        parallaxOffset: 0 // Track parallax scroll position
    });

    const planeRef = useRef(null);
    const multiplierDisplayRef = useRef(null);
    const explosionRef = useRef({ x: 0, y: 0 });

    // React state only for things that need re-renders
    const [gamePhase, setGamePhase] = useState('connecting');
    const [countdown, setCountdown] = useState(5);
    const [roundId, setRoundId] = useState(null);
    const [history, setHistory] = useState([]);
    const [liveBets, setLiveBets] = useState([]);
    const [showExplosion, setShowExplosion] = useState(false);
    const [planeLoaded, setPlaneLoaded] = useState(false);

    // Bet states
    const [bet1Amount, setBet1Amount] = useState('10.00');
    const [bet1Auto, setBet1Auto] = useState('');
    const [bet1Active, setBet1Active] = useState(false);
    const [bet1CashedOut, setBet1CashedOut] = useState(false);

    const [bet2Amount, setBet2Amount] = useState('10.00');
    const [bet2Auto, setBet2Auto] = useState('');
    const [bet2Active, setBet2Active] = useState(false);
    const [bet2CashedOut, setBet2CashedOut] = useState(false);

    // Autoplay modal states
    const [showAutoplayModal, setShowAutoplayModal] = useState(null); // null, 1, or 2 (which bet panel)
    const [autoplaySettings, setAutoplaySettings] = useState({
        1: { baseBet: '', maxStake: '', autoCashout: '', winStrategy: 'base', loseStrategy: 'base', enabled: false },
        2: { baseBet: '', maxStake: '', autoCashout: '', winStrategy: 'base', loseStrategy: 'base', enabled: false }
    });
    // Track current stake for autoplay (changes based on win/lose strategy)
    const [autoplayCurrentStake, setAutoplayCurrentStake] = useState({ 1: 0, 2: 0 });

    // Load plane image
    useEffect(() => {
        const img = new Image();
        img.src = '/plane.png';
        img.onload = () => {
            planeImageRef.current = img;
            setPlaneLoaded(true);
        };
    }, []);

    // Draw parallax layered atmospheric background
    const drawBackground = useCallback((ctx, width, height, parallaxOffset) => {
        // Dark gradient sky
        const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
        skyGradient.addColorStop(0, '#0d1b2a');
        skyGradient.addColorStop(0.5, '#1b263b');
        skyGradient.addColorStop(1, '#1a1a2e');
        ctx.fillStyle = skyGradient;
        ctx.fillRect(0, 0, width, height);

        // Layer 1: Distant mountains (slowest parallax - 0.3x speed)
        const layer1Speed = 0.3;
        const layer1Offset = (parallaxOffset * layer1Speed) % width;
        ctx.fillStyle = 'rgba(20, 30, 50, 0.8)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = -layer1Offset; x <= width + 100; x += 50) {
            const baseY = height - 50;
            const waveY = Math.sin((x + layer1Offset) * 0.008) * 30 +
                Math.sin((x + layer1Offset) * 0.015) * 15;
            ctx.lineTo(x, baseY - waveY);
        }
        ctx.lineTo(width + 100, height);
        ctx.closePath();
        ctx.fill();

        // Layer 2: Mid-distance mountains (medium parallax - 0.8x speed)
        const layer2Speed = 0.8;
        const layer2Offset = (parallaxOffset * layer2Speed) % width;
        ctx.fillStyle = 'rgba(30, 45, 70, 0.7)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = -layer2Offset; x <= width + 100; x += 40) {
            const baseY = height - 35;
            const waveY = Math.sin((x + layer2Offset) * 0.012 + 1) * 25 +
                Math.sin((x + layer2Offset) * 0.02) * 12;
            ctx.lineTo(x, baseY - waveY);
        }
        ctx.lineTo(width + 100, height);
        ctx.closePath();
        ctx.fill();

        // Layer 3: Close clouds/fog (fastest parallax - 1.5x speed)
        const layer3Speed = 1.5;
        const layer3Offset = (parallaxOffset * layer3Speed) % width;
        ctx.fillStyle = 'rgba(45, 60, 90, 0.5)';
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let x = -layer3Offset; x <= width + 100; x += 30) {
            const baseY = height - 15;
            const waveY = Math.sin((x + layer3Offset) * 0.02 + 2) * 15 +
                Math.sin((x + layer3Offset) * 0.03) * 8;
            ctx.lineTo(x, baseY - waveY);
        }
        ctx.lineTo(width + 100, height);
        ctx.closePath();
        ctx.fill();

        // Subtle grid overlay (fixed, no parallax)
        ctx.strokeStyle = 'rgba(100, 120, 150, 0.05)';
        ctx.lineWidth = 1;
        const gridSize = 40;
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
    }, []);

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

        // Update parallax offset based on multiplier (creates scrolling effect)
        if (state.phase === 'flying' || state.phase === 'crashed') {
            // Increase parallax offset based on multiplier growth - faster scrolling
            state.parallaxOffset = (mult - 1) * 600; // Doubled for faster movement
        } else {
            state.parallaxOffset = 0;
        }

        // Draw atmospheric background with parallax
        drawBackground(ctx, width, height, state.parallaxOffset);

        // Hide plane during waiting
        if (mult <= 1.01 || state.phase === 'waiting') {
            if (planeRef.current) {
                planeRef.current.style.opacity = '0';
            }
            return;
        }

        // === CURVE DRAWING LOGIC ===
        const padding = { left: 15, bottom: 15, top: 25, right: 40 };
        const graphWidth = width - padding.left - padding.right;
        const graphHeight = height - padding.top - padding.bottom;

        // Calculate "virtual time" from multiplier
        const k = 0.08;
        const virtualTime = Math.log(mult) / k;

        // Dynamic view scaling
        const maxMultForView = Math.max(mult * 1.5, 2.0);
        const maxTimeForView = Math.log(maxMultForView) / k;

        // Generate curve points
        const curvePoints = [];
        const numPoints = 100;

        for (let i = 0; i <= numPoints; i++) {
            const t = (i / numPoints) * virtualTime;
            const m = Math.exp(k * t);
            const xProgress = t / maxTimeForView;
            const x = padding.left + xProgress * graphWidth;
            const yProgress = (m - 1) / (maxMultForView - 1);
            const y = height - padding.bottom - yProgress * graphHeight;
            curvePoints.push({ x, y, mult: m });
        }

        // Draw filled area under curve with orange/golden gradient
        ctx.beginPath();
        ctx.moveTo(padding.left, height - padding.bottom);

        curvePoints.forEach(point => {
            ctx.lineTo(point.x, point.y);
        });

        const tipPoint = curvePoints[curvePoints.length - 1];
        ctx.lineTo(tipPoint.x, height - padding.bottom);
        ctx.closePath();

        // Premium orange/golden gradient fill
        const fillGradient = ctx.createLinearGradient(0, height, 0, 0);
        if (isCrashed) {
            fillGradient.addColorStop(0, 'rgba(139, 0, 0, 0.9)');
            fillGradient.addColorStop(0.3, 'rgba(180, 50, 30, 0.7)');
            fillGradient.addColorStop(0.7, 'rgba(200, 80, 50, 0.4)');
            fillGradient.addColorStop(1, 'rgba(220, 100, 60, 0.1)');
        } else {
            fillGradient.addColorStop(0, 'rgba(180, 90, 30, 0.95)');
            fillGradient.addColorStop(0.25, 'rgba(212, 140, 40, 0.8)');
            fillGradient.addColorStop(0.5, 'rgba(230, 160, 50, 0.5)');
            fillGradient.addColorStop(0.75, 'rgba(240, 180, 70, 0.25)');
            fillGradient.addColorStop(1, 'rgba(255, 200, 100, 0.05)');
        }
        ctx.fillStyle = fillGradient;
        ctx.fill();

        // Draw the curve line with golden glow
        ctx.shadowColor = isCrashed ? '#ff4757' : '#ffa500';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.moveTo(curvePoints[0].x, curvePoints[0].y);

        // Smooth quadratic curves
        for (let i = 1; i < curvePoints.length; i++) {
            const current = curvePoints[i];
            const prev = curvePoints[i - 1];
            const midX = (prev.x + current.x) / 2;
            const midY = (prev.y + current.y) / 2;
            ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
        ctx.lineTo(tipPoint.x, tipPoint.y);

        // Golden/orange line
        const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
        lineGradient.addColorStop(0, '#d4af37');
        lineGradient.addColorStop(0.5, '#ffb347');
        lineGradient.addColorStop(1, isCrashed ? '#ff4757' : '#ffd700');

        ctx.strokeStyle = lineGradient;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw glowing dot at curve tip
        if (!isCrashed) {
            ctx.beginPath();
            ctx.arc(tipPoint.x, tipPoint.y, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 20;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

        // === PLANE POSITIONING ===
        if (planeRef.current && curvePoints.length > 5) {
            const prevPoint = curvePoints[curvePoints.length - 6];
            const dx = tipPoint.x - prevPoint.x;
            const dy = tipPoint.y - prevPoint.y;
            const angleRad = Math.atan2(dy, dx);
            const angleDeg = angleRad * (180 / Math.PI);

            const offsetX = Math.cos(angleRad) * 35;
            const offsetY = Math.sin(angleRad) * 35;

            planeRef.current.style.left = `${tipPoint.x + offsetX}px`;
            planeRef.current.style.top = `${tipPoint.y + offsetY}px`;
            planeRef.current.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
            planeRef.current.style.opacity = isCrashed ? '0' : '1';

            // Store explosion position
            if (!isCrashed) {
                explosionRef.current = { x: tipPoint.x + offsetX, y: tipPoint.y + offsetY };
            }
        }

        // Update multiplier display
        if (multiplierDisplayRef.current) {
            multiplierDisplayRef.current.textContent = `${mult.toFixed(2)}x`;
        }
    }, [drawBackground]);

    // Main animation loop - 60fps
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

            if (state.phase === 'flying') {
                const lerpFactor = Math.min(1, deltaTime * 0.008);
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

            if (data.phase === 'waiting') {
                setRoundId(prevRoundId => {
                    if (prevRoundId !== data.roundId) {
                        console.log('[Aviator] New round, resetting bet states');
                        gameStateRef.current.targetMultiplier = 1.00;
                        gameStateRef.current.displayMultiplier = 1.00;
                        gameStateRef.current.crashPoint = null;
                        gameStateRef.current.parallaxOffset = 0;
                        setBet1CashedOut(false);
                        setBet2CashedOut(false);
                        setBet1Active(false);
                        setBet2Active(false);
                        setCountdown(Math.ceil((data.countdown || 5000) / 1000));
                        setLiveBets([]);
                        setShowExplosion(false);
                    }
                    return data.roundId;
                });
            } else {
                setRoundId(data.roundId);
                if (data.phase === 'crashed') {
                    gameStateRef.current.crashPoint = data.crashPoint;
                    gameStateRef.current.targetMultiplier = data.crashPoint;
                    // Trigger explosion animation
                    setShowExplosion(true);
                    setTimeout(() => setShowExplosion(false), 2000);
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
                console.log('[Aviator] Setting bet', betNum, 'active = true');
                if (betNum === 1) {
                    setBet1Active(true);
                } else if (betNum === 2) {
                    setBet2Active(true);
                }
            } else {
                toast.error(data.error || 'Bet failed');
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

    // Autoplay - automatically place bets when new round starts
    useEffect(() => {
        if (gamePhase !== 'waiting' || !roundId || !user?.id) return;

        // Check for autoplay on bet panel 1
        const settings1 = autoplaySettings[1];
        if (settings1.enabled && !bet1Active) {
            const baseBet = parseFloat(settings1.baseBet) || 0;
            const maxStake = parseFloat(settings1.maxStake) || Infinity;
            const currentStake = autoplayCurrentStake[1] || baseBet;

            // Calculate bet amount
            let betAmount = currentStake > 0 ? currentStake : baseBet;

            // Check max stake limit
            if (maxStake > 0 && betAmount > maxStake) {
                betAmount = maxStake;
            }

            if (betAmount > 0 && socketRef.current) {
                console.log('[Autoplay] Placing auto bet 1:', betAmount, 'auto cashout:', settings1.autoCashout);
                setBet1Amount(betAmount.toString());
                setBet1Active('pending');
                socketRef.current.emit('place_bet', {
                    userId: user.id,
                    amount: betAmount,
                    betNumber: 1,
                    autoCashout: parseFloat(settings1.autoCashout) || null
                });
            }
        }

        // Check for autoplay on bet panel 2
        const settings2 = autoplaySettings[2];
        if (settings2.enabled && !bet2Active) {
            const baseBet = parseFloat(settings2.baseBet) || 0;
            const maxStake = parseFloat(settings2.maxStake) || Infinity;
            const currentStake = autoplayCurrentStake[2] || baseBet;

            let betAmount = currentStake > 0 ? currentStake : baseBet;

            if (maxStake > 0 && betAmount > maxStake) {
                betAmount = maxStake;
            }

            if (betAmount > 0 && socketRef.current) {
                console.log('[Autoplay] Placing auto bet 2:', betAmount, 'auto cashout:', settings2.autoCashout);
                setBet2Amount(betAmount.toString());
                setBet2Active('pending');
                socketRef.current.emit('place_bet', {
                    userId: user.id,
                    amount: betAmount,
                    betNumber: 2,
                    autoCashout: parseFloat(settings2.autoCashout) || null
                });
            }
        }
    }, [gamePhase, roundId, user?.id, autoplaySettings, autoplayCurrentStake, bet1Active, bet2Active]);

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

    // Save autoplay settings and enable
    const saveAutoplaySettings = (betNum, settings) => {
        setAutoplaySettings(prev => ({
            ...prev,
            [betNum]: { ...settings, enabled: true }
        }));
        // Initialize current stake with base bet
        const baseBet = parseFloat(settings.baseBet) || parseFloat(betNum === 1 ? bet1Amount : bet2Amount) || 10;
        setAutoplayCurrentStake(prev => ({
            ...prev,
            [betNum]: baseBet
        }));
        // Also set the auto cashout value for the bet
        if (betNum === 1) {
            setBet1Auto(settings.autoCashout);
            setBet1Amount(baseBet.toString());
        } else {
            setBet2Auto(settings.autoCashout);
            setBet2Amount(baseBet.toString());
        }
        setShowAutoplayModal(null);
        toast.success(`Autoplay enabled! Base bet: $${baseBet.toFixed(2)}, Auto cashout: ${settings.autoCashout}x`);
    };

    // Disable autoplay
    const disableAutoplay = (betNum) => {
        setAutoplaySettings(prev => ({
            ...prev,
            [betNum]: { ...prev[betNum], enabled: false }
        }));
        if (betNum === 1) {
            setBet1Auto('');
        } else {
            setBet2Auto('');
        }
        setShowAutoplayModal(null);
    };

    // Autoplay Modal Component
    const AutoplayModal = ({ betNum, onClose }) => {
        const currentSettings = autoplaySettings[betNum] || {};
        const [localSettings, setLocalSettings] = useState({
            baseBet: currentSettings.baseBet || '',
            maxStake: currentSettings.maxStake || '',
            autoCashout: currentSettings.autoCashout || '',
            winStrategy: currentSettings.winStrategy || 'base',
            loseStrategy: currentSettings.loseStrategy || 'base'
        });

        const handleSave = () => {
            if (!localSettings.autoCashout || parseFloat(localSettings.autoCashout) < 1.01) {
                toast.error('Auto cashout must be at least 1.01x');
                return;
            }
            saveAutoplaySettings(betNum, localSettings);
        };

        return (
            <div className="modal-overlay" onClick={onClose}>
                <div className="autoplay-modal" onClick={e => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2>Autoplay</h2>
                        <button className="modal-close" onClick={onClose}>✕</button>
                    </div>

                    <div className="modal-body">
                        {/* Input fields row */}
                        <div className="modal-inputs">
                            <div className="modal-input-group">
                                <label>Base bet</label>
                                <div className="modal-input-box">
                                    <input
                                        type="number"
                                        placeholder="Enter amount"
                                        value={localSettings.baseBet}
                                        onChange={e => setLocalSettings(s => ({ ...s, baseBet: e.target.value }))}
                                    />
                                    <button onClick={() => setLocalSettings(s => ({ ...s, baseBet: '' }))}>✕</button>
                                </div>
                            </div>

                            <div className="modal-input-group">
                                <label>Max. stake amount</label>
                                <div className="modal-input-box">
                                    <input
                                        type="number"
                                        placeholder="Enter amount"
                                        value={localSettings.maxStake}
                                        onChange={e => setLocalSettings(s => ({ ...s, maxStake: e.target.value }))}
                                    />
                                    <button onClick={() => setLocalSettings(s => ({ ...s, maxStake: '' }))}>✕</button>
                                </div>
                            </div>

                            <div className="modal-input-group">
                                <label>Auto cashout (≥ 1.01)</label>
                                <div className="modal-input-box">
                                    <input
                                        type="number"
                                        placeholder="Enter odds"
                                        step="0.01"
                                        min="1.01"
                                        value={localSettings.autoCashout}
                                        onChange={e => setLocalSettings(s => ({ ...s, autoCashout: e.target.value }))}
                                    />
                                    <button onClick={() => setLocalSettings(s => ({ ...s, autoCashout: '' }))}>✕</button>
                                </div>
                            </div>
                        </div>

                        {/* Strategy sections */}
                        <div className="modal-strategies">
                            <div className="strategy-section">
                                <h3>IF YOU WIN</h3>
                                <label className="radio-option">
                                    <input
                                        type="radio"
                                        name={`win-${betNum}`}
                                        checked={localSettings.winStrategy === 'base'}
                                        onChange={() => setLocalSettings(s => ({ ...s, winStrategy: 'base' }))}
                                    />
                                    <span className="radio-checkmark"></span>
                                    Back to base stake
                                </label>
                                <label className="radio-option">
                                    <input
                                        type="radio"
                                        name={`win-${betNum}`}
                                        checked={localSettings.winStrategy === 'double'}
                                        onChange={() => setLocalSettings(s => ({ ...s, winStrategy: 'double' }))}
                                    />
                                    <span className="radio-checkmark"></span>
                                    Double your stake
                                </label>
                            </div>

                            <div className="strategy-section">
                                <h3>IF YOU LOSE</h3>
                                <label className="radio-option">
                                    <input
                                        type="radio"
                                        name={`lose-${betNum}`}
                                        checked={localSettings.loseStrategy === 'base'}
                                        onChange={() => setLocalSettings(s => ({ ...s, loseStrategy: 'base' }))}
                                    />
                                    <span className="radio-checkmark"></span>
                                    Back to base stake
                                </label>
                                <label className="radio-option">
                                    <input
                                        type="radio"
                                        name={`lose-${betNum}`}
                                        checked={localSettings.loseStrategy === 'double'}
                                        onChange={() => setLocalSettings(s => ({ ...s, loseStrategy: 'double' }))}
                                    />
                                    <span className="radio-checkmark"></span>
                                    Double your stake
                                </label>
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        {currentSettings.enabled && (
                            <button className="disable-autoplay-btn" onClick={() => disableAutoplay(betNum)}>
                                DISABLE AUTOPLAY
                            </button>
                        )}
                        <button className="place-autobet-btn" onClick={handleSave}>
                            PLACE AUTOBET
                        </button>
                    </div>
                </div>
            </div>
        );
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

        // Quick bet amounts
        const quickAmounts = [10, 50, 100, 500, 1000, 5000];

        return (
            <div className="bet-panel">
                {/* Amount input with clear button */}
                <div className="bet-amount-row">
                    <div className="amount-input-box">
                        <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            disabled={active}
                            min="0.01"
                            step="0.01"
                            placeholder="0.00"
                        />
                        <button
                            className="clear-btn"
                            onClick={() => setAmount('0')}
                            disabled={active}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {/* Quick amount buttons */}
                <div className="quick-amounts">
                    {quickAmounts.map((amt) => (
                        <button
                            key={amt}
                            className="quick-amount-btn"
                            onClick={() => setAmount(amt.toString())}
                            disabled={active}
                        >
                            {amt >= 1000 ? `${amt / 1000}K` : amt}
                        </button>
                    ))}
                </div>

                {/* Action buttons row */}
                <div className="action-buttons">
                    {/* Auto cashout toggle - opens modal */}
                    <button
                        className={`auto-btn ${autoplaySettings[betNum]?.enabled ? 'active' : ''}`}
                        onClick={() => setShowAutoplayModal(betNum)}
                        disabled={active}
                    >
                        {autoplaySettings[betNum]?.enabled
                            ? `AUTO ${autoplaySettings[betNum].autoCashout}x`
                            : 'AUTO OFF'}
                    </button>

                    {/* Main action button */}
                    {canBet && (
                        <button className="bet-btn" onClick={() => placeBet(betNum)}>
                            <span className="bet-btn-text">PLACE BET</span>
                            <span className="bet-btn-amount">${parseFloat(amount || 0).toFixed(2)}</span>
                        </button>
                    )}

                    {isPending && (
                        <button className="waiting-btn" disabled>
                            PLACING...
                        </button>
                    )}

                    {canCashout && (
                        <button className="cashout-btn" onClick={() => cashOut(betNum)}>
                            CASH OUT
                        </button>
                    )}

                    {isActive && cashedOut && (
                        <button className="cashed-btn" disabled>
                            WON ✓
                        </button>
                    )}

                    {gamePhase === 'crashed' && isActive && !cashedOut && (
                        <button className="lost-btn" disabled>
                            LOST
                        </button>
                    )}

                    {gamePhase === 'flying' && !isActive && !isPending && (
                        <button className="waiting-btn" disabled>
                            NEXT ROUND
                        </button>
                    )}
                </div>
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

                        {/* Plane overlay - PNG image */}
                        <div
                            ref={planeRef}
                            className="plane-container"
                            style={{ opacity: 0 }}
                        >
                            <img
                                src="/plane.png"
                                alt="Aviator Plane"
                                className="plane-image"
                            />
                            {/* Engine glow effect */}
                            {gamePhase === 'flying' && (
                                <div className="engine-glow" />
                            )}
                        </div>

                        {/* Explosion effect */}
                        <ExplosionEffect
                            x={explosionRef.current.x}
                            y={explosionRef.current.y}
                            active={showExplosion}
                        />

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

                    {/* Betting Panels */}
                    <div className="betting-area">
                        {renderBetPanel(1)}
                        {renderBetPanel(2)}
                    </div>

                    {/* Live Bets */}
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

            {/* Autoplay Modal */}
            {showAutoplayModal && (
                <AutoplayModal
                    betNum={showAutoplayModal}
                    onClose={() => setShowAutoplayModal(null)}
                />
            )}
        </div>
    );
};

export default Aviator;
