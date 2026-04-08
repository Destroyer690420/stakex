/**
 * IPL LIVE SOCKET HANDLER
 * ========================
 * Background loop that scrapes live IPL data every 45 seconds.
 * Only runs during IPL match hours (2 PM – 11:59 PM IST).
 *
 * Events emitted:
 *   'ipl-update'          – Live match data + odds (every 45s)
 *   'ipl-match-ended'     – Match completed, settlement triggered
 *   'ipl-betting-closed'  – Overs > 18.5, no more bets
 */

const {
    getActiveMatches,
    shouldScrapeNow,
    IPL_TEAMS
} = require('../services/iplScraper');

const { settleMatch } = require('../services/iplSettlement');

// Track settled matches to prevent double-settlement
const settledMatches = new Set();

// Track previous betting status per match
const prevBettingOpen = new Map();

function initIPLLive(io) {
    let scrapeInterval = null;
    let checkInterval = null;

    console.log('🏏 [IPL Live] Initialized – Real Cricbuzz scraping mode');

    // ---------------------------------------------------
    // Socket connection handling
    // ---------------------------------------------------
    io.on('connection', (socket) => {
        socket.on('join_ipl', async () => {
            socket.join('ipl');
            console.log(`[IPL Live] Client joined IPL room: ${socket.id}`);

            // Send initial data immediately
            try {
                const data = await getActiveMatches();
                socket.emit('ipl-update', data);
            } catch (err) {
                console.error('[IPL Live] Error sending initial data:', err.message);
                socket.emit('ipl-update', { live: [], completed: [], upcoming: [], demoMode: false });
            }
        });

        socket.on('leave_ipl', () => {
            socket.leave('ipl');
        });

        // Let users join a personal room for settlement notifications
        socket.on('join_user_room', (userId) => {
            if (userId) socket.join(`user_${userId}`);
        });
    });

    // ---------------------------------------------------
    // Main scrape/broadcast loop (every 45 seconds)
    // ---------------------------------------------------
    async function scrapeAndBroadcast() {
        try {
            const data = await getActiveMatches();

            // Broadcast to all clients in the 'ipl' room
            io.to('ipl').emit('ipl-update', data);

            // Check for match endings → trigger settlement
            for (const match of data.completed || []) {
                if (match.winner && !settledMatches.has(match.id)) {
                    settledMatches.add(match.id);

                    console.log(`🏏 [IPL Live] Match ended: ${match.id} → Winner: ${match.winner}`);

                    io.to('ipl').emit('ipl-match-ended', {
                        matchId: match.id,
                        winner: match.winner,
                        winnerName: IPL_TEAMS[match.winner]?.name || match.winner,
                        statusText: match.statusText
                    });

                    // Trigger auto-settlement
                    const result = await settleMatch(match.id, match.winner, io);
                    console.log('[IPL Live] Settlement result:', result);
                }
            }

            // Check for betting-closed transitions
            for (const match of data.live || []) {
                const wasOpen = prevBettingOpen.get(match.id);
                if (wasOpen === true && match.is_betting_open === false) {
                    io.to('ipl').emit('ipl-betting-closed', {
                        matchId: match.id,
                        message: 'Betting closed – overs exceeded 18.5'
                    });
                    console.log(`[IPL Live] Betting closed for match ${match.id}`);
                }
                prevBettingOpen.set(match.id, match.is_betting_open);
            }

        } catch (err) {
            console.error('[IPL Live] Scrape error:', err.message);
        }
    }

    // ---------------------------------------------------
    // Scheduler: start/stop scraping based on match hours
    // ---------------------------------------------------
    function startScraping() {
        if (scrapeInterval) return;
        console.log('🏏 [IPL Live] Starting 45-second scrape loop');
        scrapeAndBroadcast();
        scrapeInterval = setInterval(scrapeAndBroadcast, 45 * 1000);
    }

    function stopScraping() {
        if (!scrapeInterval) return;
        console.log('🏏 [IPL Live] Stopping scrape loop (outside match hours)');
        clearInterval(scrapeInterval);
        scrapeInterval = null;
    }

    function checkSchedule() {
        if (shouldScrapeNow()) {
            startScraping();
        } else {
            stopScraping();
        }
    }

    // Initial check + re-check every 60 seconds
    checkSchedule();
    checkInterval = setInterval(checkSchedule, 60 * 1000);

    process.on('SIGTERM', () => {
        stopScraping();
        if (checkInterval) clearInterval(checkInterval);
    });
}

module.exports = initIPLLive;
