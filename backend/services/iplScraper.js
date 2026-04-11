/**
 * IPL CRICKET SCRAPER SERVICE  –  LIVE MODE
 * ==========================================
 * Scrapes real IPL 2026 match data from Cricbuzz.
 * Schedule is fetched on startup + refreshed periodically.
 * Live scores scraped every 45 s during match windows.
 */

const axios = require('axios');
const cheerio = require('cheerio');

// ============================================
// IPL TEAM DATA
// ============================================
const IPL_TEAMS = {
    MI:   { name: 'Mumbai Indians',              short: 'MI',   color: '#004BA0', elo: 84 },
    CSK:  { name: 'Chennai Super Kings',         short: 'CSK',  color: '#FDB913', elo: 85 },
    RCB:  { name: 'Royal Challengers Bengaluru', short: 'RCB',  color: '#EC1C24', elo: 77 },
    KKR:  { name: 'Kolkata Knight Riders',       short: 'KKR',  color: '#3B215D', elo: 80 },
    SRH:  { name: 'Sunrisers Hyderabad',         short: 'SRH',  color: '#FF822A', elo: 78 },
    DC:   { name: 'Delhi Capitals',              short: 'DC',   color: '#17479E', elo: 75 },
    PBKS: { name: 'Punjab Kings',                short: 'PBKS', color: '#ED1B24', elo: 73 },
    RR:   { name: 'Rajasthan Royals',            short: 'RR',   color: '#EA1A85', elo: 80 },
    LSG:  { name: 'Lucknow Super Giants',        short: 'LSG',  color: '#A72056', elo: 82 },
    GT:   { name: 'Gujarat Titans',              short: 'GT',   color: '#1B2133', elo: 81 }
};

/**
 * Deterministic pre-match win probability based on Team ELO ratings
 */
function getPreMatchProbabilities(t1Code, t2Code) {
    const elo1 = IPL_TEAMS[t1Code]?.elo || 80;
    const elo2 = IPL_TEAMS[t2Code]?.elo || 80;
    const total = elo1 + elo2;
    
    // Add a slight deterministic randomized sway (-2% to +2%) based on match pair hash
    const sway = ((t1Code.charCodeAt(0) + t2Code.charCodeAt(0)) % 5) - 2; 
    
    let prob1 = ((elo1 / total) * 100) + sway;
    let prob2 = 100 - prob1;
    
    return { t1: prob1, t2: prob2 };
}

const TEAM_KEYS = Object.keys(IPL_TEAMS);

const CRICBUZZ_BASE  = 'https://www.cricbuzz.com';
const IPL_SERIES_ID  = '9241';                         // IPL 2026
const IPL_SERIES_URL = `${CRICBUZZ_BASE}/cricket-series/${IPL_SERIES_ID}/indian-premier-league-2026/matches`;
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

// ============================================
// CACHED SCHEDULE (refreshed every 30 min)
// ============================================
let cachedSchedule = [];
let scheduleLastFetched = 0;
const SCHEDULE_TTL = 30 * 60 * 1000; // 30 minutes

// ============================================
// ODDS CALCULATION ENGINE
// ============================================

/**
 * Calculate betting odds based on live match state.
 *
 * First innings:  Compare actual score to "par score" at current over.
 * Second innings: RRR vs CRR differential + wicket penalty.
 * If RRR > CRR + 3 → boost underdog (chasing team) payout.
 *
 * Payout range: ×1.20  –  ×6.00
 */
function calculateOdds(matchData) {
    const {
        team1Score = 0, team1Wickets = 0, team1Overs = 0,
        team2Score = 0, team2Wickets = 0, team2Overs = 0,
        innings = 1, target = 0
    } = matchData;

    const TOTAL_OVERS = 20;
    let team1Odds = 1.95;
    let team2Odds = 1.95;

    if (matchData.t1WinProb && matchData.t2WinProb) {
        // High win prob = low payout (high likelihood of happening)
        const t1OddsRaw = (100 / matchData.t1WinProb) * 0.95; // 5% house edge
        const t2OddsRaw = (100 / matchData.t2WinProb) * 0.95;
        return {
            team1Odds: r2(clampOddsDB(t1OddsRaw)),
            team2Odds: r2(clampOddsDB(t2OddsRaw))
        };
    }

    if (innings === 1) {
        const ov = parseFloat(team1Overs) || 0;
        if (ov < 1) return { team1Odds: 1.95, team2Odds: 1.95 };

        const parScore = (ov / TOTAL_OVERS) * 170;
        const diff = team1Score - parScore;
        const wicketPenalty = team1Wickets * 0.12;
        const shift = (diff / 30) - wicketPenalty;

        team1Odds = clampOdds(1.95 - shift * 0.30);
        team2Odds = clampOdds(1.95 + shift * 0.30);
    } else {
        const isT1Chasing = matchData.chasingTeam === 1;
        const chasingScore = isT1Chasing ? team1Score : team2Score;
        const chasingWickets = isT1Chasing ? team1Wickets : team2Wickets;
        const ov = parseFloat(isT1Chasing ? team1Overs : team2Overs) || 0;
        
        if (ov < 0.1) {
            const tDiff = (target || 170) - 170;
            const shift = (tDiff / 40) * 0.2;
            team1Odds = clampOdds(1.95 + (isT1Chasing ? -shift : shift));
            team2Odds = clampOdds(1.95 + (isT1Chasing ? shift : -shift));
            return { team1Odds: r2(team1Odds), team2Odds: r2(team2Odds) };
        }

        const runsNeeded = (target || 170) - chasingScore;
        const oversLeft  = Math.max(0.1, TOTAL_OVERS - ov);

        if (runsNeeded <= 0) {
            return isT1Chasing ? { team1Odds: 1.10, team2Odds: 6.50 } : { team1Odds: 6.50, team2Odds: 1.10 };
        }

        const rrr = runsNeeded / oversLeft;
        const crr = chasingScore / ov;
        const wicketPen = chasingWickets * 0.25;
        const adjusted = (rrr - crr) + wicketPen;

        const oddsChasing = clampOdds(1.95 + adjusted * 0.20);
        const oddsDefending = clampOdds(1.95 - adjusted * 0.20);

        team1Odds = isT1Chasing ? oddsChasing : oddsDefending;
        team2Odds = isT1Chasing ? oddsDefending : oddsChasing;

        // If RRR > CRR + 3, boost underdog payout
        if (rrr > crr + 3) {
            if (isT1Chasing) {
                team1Odds = clampOdds(team1Odds + 0.50);
                team2Odds = clampOdds(team2Odds - 0.30);
            } else {
                team2Odds = clampOdds(team2Odds + 0.50);
                team1Odds = clampOdds(team1Odds - 0.30);
            }
        }
    }

    return { team1Odds: r2(clampOddsDB(team1Odds)), team2Odds: r2(clampOddsDB(team2Odds)) };
}

function clampOddsDB(v) { return Math.max(1.10, Math.min(6.50, v)); }
function clampOdds(v) { return Math.max(1.20, Math.min(6.00, v)); }
function r2(n) { return Math.round(n * 100) / 100; }

// ============================================
// SCHEDULE SCRAPER
// ============================================

/**
 * Fetch all IPL 2026 matches (past, live, upcoming) from the
 * Cricbuzz series page.  Returns an array sorted by match number.
 */
async function fetchIPLSchedule() {
    const now = Date.now();
    if (cachedSchedule.length > 0 && now - scheduleLastFetched < SCHEDULE_TTL) {
        return cachedSchedule;
    }

    console.log('[IPL Scraper] Fetching IPL 2026 schedule from Cricbuzz …');

    try {
        const { data: html } = await axios.get(IPL_SERIES_URL, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(html);
        const matches = [];

        // Scrape every link that points to a live-cricket-scores page
        // and belongs to the IPL series
        $('a[href*="/live-cricket-scores/"]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const text = ($(el).text() || '').trim();

            // Only IPL matches
            if (!href.includes('ipl-2026') && !href.includes('indian-premier-league-2026')) return;

            const idMatch = href.match(/\/live-cricket-scores\/(\d+)\//);
            if (!idMatch) return;

            const cricbuzzId = idMatch[1];

            // Extract match number from text like "14th Match" / "1st Match"
            const numMatch = text.match(/(\d+)(?:st|nd|rd|th)\s+match/i);
            const matchNumber = numMatch ? parseInt(numMatch[1]) : 0;

            // Extract team codes from URL slug  e.g. gt-vs-dc
            const slugMatch = href.match(/\/(\w+?)-vs-(\w+?)-/);
            let t1Code = '', t2Code = '';
            if (slugMatch) {
                t1Code = identifyTeam(slugMatch[1]);
                t2Code = identifyTeam(slugMatch[2]);
            }

            // Determine status from link text
            let status = 'upcoming';
            if (/live/i.test(text))       status = 'live';
            else if (/won|tied/i.test(text))  status = 'completed';
            else if (/preview|upcoming/i.test(text) || !/won|live|tied/i.test(text)) status = 'upcoming';

            // Avoid duplicates but merge info
            const existing = matches.find(m => m.cricbuzzId === cricbuzzId);
            if (existing) {
                if (status === 'live' || status === 'completed') existing.status = status;
                if (!existing.matchNumber && matchNumber) existing.matchNumber = matchNumber;
                if (t1Code && !existing.team1) existing.team1 = t1Code;
                if (t2Code && !existing.team2) existing.team2 = t2Code;
                return;
            }

            matches.push({
                cricbuzzId,
                matchNumber,
                team1: t1Code,
                team2: t2Code,
                team1Name: IPL_TEAMS[t1Code]?.name || t1Code,
                team2Name: IPL_TEAMS[t2Code]?.name || t2Code,
                status,
                statusText: text,
                url: `${CRICBUZZ_BASE}${href}`
            });
        });

        matches.sort((a, b) => a.matchNumber - b.matchNumber);

        cachedSchedule = matches;
        scheduleLastFetched = now;
        console.log(`[IPL Scraper] Found ${matches.length} IPL 2026 match(es) in schedule`);
        return matches;
    } catch (err) {
        console.error('[IPL Scraper] Schedule fetch error:', err.message);
        return cachedSchedule; // Return stale cache on error
    }
}

// ============================================
// LIVE MATCH SCRAPER
// ============================================

/**
 * Scrape detailed live score for a specific match from its
 * Cricbuzz page.  Uses both OG meta + HTML selectors.
 */
async function scrapeMatchDetail(cricbuzzId, forceCompleted = false) {
    try {
        const url = `${CRICBUZZ_BASE}/live-cricket-scores/${cricbuzzId}`;
        const { data: html } = await axios.get(url, { headers: HEADERS, timeout: 12000 });
        const $ = cheerio.load(html);

        // --- 1. Parse OG description (most reliable) ---
        // Format: "DC 118/3 (12) vs GT 210/4 (KL Rahul 64(35)...)"
        const ogDesc = $('meta[property="og:description"]').attr('content') || '';
        const ogTitle = $('meta[property="og:title"]').attr('content') || '';

        // Extract status text
        const statusEl = $('div.cb-text-live, div.cb-text-complete, .cb-min-stts, .cb-text-stumps, .cb-text-inprogress');
        let statusTxt = statusEl.first().text().trim();
        if (!statusTxt) {
            // Fallback: look in mini status bar
            statusTxt = $('.cb-min-stts').text().trim();
        }

        // --- 2. Parse scores from OG description ---
        const parseScoreFromOG = (desc) => {
            // Matches patterns like "DC 118/3 (12)" or "GT 210/4"
            const scoreRegex = /([A-Z]{2,5})\s+(\d+)\/(\d+)\s*(?:\((\d+\.?\d*)\))?/g;
            const scores = [];
            let match;
            while ((match = scoreRegex.exec(desc)) !== null) {
                scores.push({
                    teamCode: match[1],
                    runs: parseInt(match[2]),
                    wickets: parseInt(match[3]),
                    overs: match[4] ? parseFloat(match[4]) : 0
                });
            }
            return scores;
        };

        const parsedScores = parseScoreFromOG(ogDesc);

        // --- 3. Identify teams ---
        // From og:title format "Delhi Capitals vs Gujarat Titans, 14th Match..."
        const titleParts = ogTitle.split(',')[0] || '';
        const vsMatch = titleParts.match(/(.+?)\s+vs\s+(.+)/i);
        let t1FullName = '', t2FullName = '';
        if (vsMatch) {
            t1FullName = vsMatch[1].trim();
            t2FullName = vsMatch[2].trim();
        }

        const t1Code = identifyTeam(t1FullName) || (parsedScores[0]?.teamCode) || 'UNK';
        const t2Code = identifyTeam(t2FullName) || (parsedScores[1]?.teamCode) || 'UNK';

        // --- 4. Build score data ---
        // parsedScores[0] is the first team mentioned in OG (team batting first or currently batting)
        let s1 = { runs: 0, wickets: 0, overs: 0 };
        let s2 = { runs: 0, wickets: 0, overs: 0 };

        if (parsedScores.length >= 2) {
            // Two scores = second innings
            // OG format: "DC 118/3 (12) vs GT 210/4" — chasing team first, then batting-first team
            // Match OG team codes to our identified teams
            for (const ps of parsedScores) {
                const code = identifyTeam(ps.teamCode) || ps.teamCode;
                if (code === t1Code) {
                    s1 = { runs: ps.runs, wickets: ps.wickets, overs: ps.overs };
                } else if (code === t2Code) {
                    s2 = { runs: ps.runs, wickets: ps.wickets, overs: ps.overs };
                }
            }
        } else if (parsedScores.length === 1) {
            // One score = first innings
            const ps = parsedScores[0];
            const code = identifyTeam(ps.teamCode) || ps.teamCode;
            if (code === t1Code) {
                s1 = { runs: ps.runs, wickets: ps.wickets, overs: ps.overs };
            } else {
                s2 = { runs: ps.runs, wickets: ps.wickets, overs: ps.overs };
            }
        }

        // --- 5. Fallback: parse from HTML selectors ---
        if (s1.runs === 0 && s2.runs === 0) {
            const scoreEls = $('.cb-font-20');
            if (scoreEls.length >= 1) {
                const parsed = parseScoreText(scoreEls.eq(0).text().trim());
                s1 = parsed;
            }
            if (scoreEls.length >= 2) {
                const parsed = parseScoreText(scoreEls.eq(1).text().trim());
                s2 = parsed;
            }
        }

        let isDone = forceCompleted || /won|tied|match ended|no result/i.test(statusTxt);
        const isLive = !isDone && (s1.runs > 0 || /need|require|batting|live|opt|elected/i.test(statusTxt));

        let innings = 1, tgt = 0;
        let chasingTeam = null; // 1 or 2
        
        // If both teams have scored, it's second innings
        if (s1.runs > 0 && s2.runs > 0) {
            innings = 2;
            // Identify chasing team based on overs
            if (s1.overs > 0 && s1.overs < 20 && (s2.overs >= 20 || s2.overs === 0 || s1.overs < s2.overs)) chasingTeam = 1;
            else if (s2.overs > 0 && s2.overs < 20 && (s1.overs >= 20 || s1.overs === 0 || s2.overs < s1.overs)) chasingTeam = 2;
            else chasingTeam = 2; // fallback assumes team2 chasing
            
            tgt = (chasingTeam === 1 ? s2.runs : s1.runs) + 1;
        }

        // Also detect 2nd innings from status text  "need X off Y"
        if (/need|require|target/i.test(statusTxt) && Math.max(s1.runs, s2.runs) > 0) {
            innings = 2;
            if (!chasingTeam) {
                 const lowTxt = statusTxt.toLowerCase();
                 if (lowTxt.includes(t1Code.toLowerCase()) || lowTxt.includes(t1FullName.toLowerCase())) chasingTeam = 1;
                 else chasingTeam = 2;
            }
            if (!tgt) tgt = (chasingTeam === 1 ? s2.runs : s1.runs) + 1;
        }
        if (!chasingTeam && innings === 2) chasingTeam = 2; // fallback

        let currentOvers = 0;
        if (parsedScores.length > 0) {
            currentOvers = parsedScores[0].overs;
        } else {
            currentOvers = Math.min(s1.overs || 0, s2.overs || 0);
            if (currentOvers === 0 || currentOvers === 20) currentOvers = Math.max(s1.overs || 0, s2.overs || 0); // fallback
        }

        // --- 6.1 Logical Check for Match End (if text hasn't updated) ---
        if (!isDone && innings === 2) {
            const chasingObj = chasingTeam === 1 ? s1 : s2;
            if (chasingObj.runs >= tgt) {
                isDone = true; // Chasing team reached target
            } else if (chasingObj.wickets >= 10 || chasingObj.overs >= 19.6 || chasingObj.overs >= 20) {
                isDone = true; // Chasing team all out or overs finished
            }
        }

        // --- 7. Extract venue and Win Probability ---
        const venueEl = $('a[href*="/venues/"]').first().text().trim();

        let t1WinProb = 0, t2WinProb = 0;
        let winProbRaw = '';
        $('*').each((_, el) => {
            const txt = $(el).text().trim().toLowerCase();
            if (txt === 'win probability' || txt === 'live win probability' || txt.includes('win probability')) {
                const pText = $(el).parent().text().replace(/\s+/g, '');
                if (pText.length > 20) winProbRaw = pText;
            }
        });
        
        if (winProbRaw) {
            // e.g. "LiveWinProbabilityDC15%GT85%" or "WinProbabilityDC24%GT76%"
            const probMatch = winProbRaw.match(/(?:Live)?WinProbability([A-Za-z]+)(\d+)(?:\.\d+)?%([A-Za-z]+)(\d+)(?:\.\d+)?%/i);
            if (probMatch) {
                const matchedT1 = identifyTeam(probMatch[1]);
                const pVal1 = parseInt(probMatch[2]);
                const matchedT2 = identifyTeam(probMatch[3]);
                const pVal2 = parseInt(probMatch[4]);
                
                if (matchedT1 === t1Code) t1WinProb = pVal1;
                else if (matchedT1 === t2Code) t2WinProb = pVal1;
                
                if (matchedT2 === t1Code) t1WinProb = pVal2;
                else if (matchedT2 === t2Code) t2WinProb = pVal2;
            }
        }

        const md = {
            id: `cb_${cricbuzzId}`,
            cricbuzzId,
            team1: t1Code, team2: t2Code,
            team1Name: IPL_TEAMS[t1Code]?.name || t1FullName || t1Code,
            team2Name: IPL_TEAMS[t2Code]?.name || t2FullName || t2Code,
            team1Score: s1.runs, team1Wickets: s1.wickets, team1Overs: s1.overs,
            team2Score: s2.runs, team2Wickets: s2.wickets, team2Overs: s2.overs,
            innings, target: tgt, chasingTeam,
            t1WinProb, t2WinProb,
            status: isDone ? 'completed' : isLive ? 'live' : 'upcoming',
            statusText: statusTxt || ogDesc.substring(0, 80),
            is_betting_open: isLive && currentOvers <= 18.5,
            venue: venueEl || '',
            winner: null,
            date: new Date().toISOString()
        };

        // Calculate odds
        const odds = calculateOdds(md);
        md.team1Odds = odds.team1Odds;
        md.team2Odds = odds.team2Odds;

        // Determine winner
        if (isDone) {
            const stl = statusTxt.toLowerCase();
            for (const [code, team] of Object.entries(IPL_TEAMS)) {
                if (stl.includes(team.name.toLowerCase()) || stl.includes(code.toLowerCase())) {
                    // Check if status says this team "won"
                    if (stl.includes('won')) {
                        md.winner = code;
                        break;
                    }
                }
            }

            // Math fallback if text doesn't identify winner
            if (!md.winner && md.innings === 2) {
                const isT1Chasing = md.chasingTeam === 1;
                const chasingRuns = isT1Chasing ? md.team1Score : md.team2Score;
                
                if (chasingRuns >= md.target) {
                    md.winner = isT1Chasing ? md.team1 : md.team2;
                } else if (chasingRuns < md.target - 1) { // Fell short
                    md.winner = isT1Chasing ? md.team2 : md.team1;
                } else {
                    md.winner = 'TIED'; // Same score
                }
            }
        }

        return md;
    } catch (err) {
        console.error(`[IPL Scraper] Error scraping match ${cricbuzzId}:`, err.message);
        return null;
    }
}

function parseScoreText(txt) {
    const m = txt.match(/(\d+)\/(\d+)\s*\((\d+\.?\d*)\)/);
    if (m) return { runs: +m[1], wickets: +m[2], overs: +m[3] };
    const m2 = txt.match(/(\d+)\/(\d+)/);
    if (m2) return { runs: +m2[1], wickets: +m2[2], overs: 0 };
    return { runs: 0, wickets: 0, overs: 0 };
}

function identifyTeam(name) {
    if (!name) return '';
    const l = name.toLowerCase().trim();
    const map = {
        mumbai: 'MI', mi: 'MI',
        chennai: 'CSK', csk: 'CSK',
        bengaluru: 'RCB', bangalore: 'RCB', rcb: 'RCB',
        kolkata: 'KKR', kkr: 'KKR',
        hyderabad: 'SRH', sunriser: 'SRH', srh: 'SRH',
        delhi: 'DC', dc: 'DC',
        punjab: 'PBKS', pbks: 'PBKS',
        rajasthan: 'RR', rr: 'RR',
        lucknow: 'LSG', lsg: 'LSG',
        gujarat: 'GT', gt: 'GT'
    };
    for (const [k, v] of Object.entries(map)) { if (l.includes(k)) return v; }
    return l.substring(0, 3).toUpperCase();
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Main entry point – returns live, completed and upcoming matches
 * with calculated odds for every live match.
 */
async function getActiveMatches() {
    try {
        // 1. Get schedule (cached / refreshed)
        const schedule = await fetchIPLSchedule();

        // 2. Find which matches need live scraping
        const liveOrRecent = schedule.filter(m => m.status === 'live');
        const upcomingSch  = schedule.filter(m => m.status === 'upcoming');
        const completedSch = schedule.filter(m => m.status === 'completed');

        // 3. Scrape detailed data for live matches
        const liveDetailed = [];
        for (const m of liveOrRecent) {
            const detail = await scrapeMatchDetail(m.cricbuzzId);
            if (detail) liveDetailed.push(detail);
        }

        // 4. Pre-Match Betting Fallback
        //    If there are no live games, the next upcoming match becomes available for betting.
        if (liveDetailed.length === 0 && upcomingSch.length > 0) {
            const nextMatch = upcomingSch[0];
            const detail = await scrapeMatchDetail(nextMatch.cricbuzzId);
            
            if (detail && detail.status === 'live') {
                liveDetailed.push(detail);
            } else {
                // If detail exists but is 'upcoming', or if it failed to scrape (commentary uninitialized)
                // We mock/override the detail to force pre-match betting open!
                const preMatch = detail || {
                    id: `cb_${nextMatch.cricbuzzId}`,
                    cricbuzzId: nextMatch.cricbuzzId,
                    team1: nextMatch.team1, team2: nextMatch.team2,
                    team1Name: IPL_TEAMS[nextMatch.team1]?.name || nextMatch.team1,
                    team2Name: IPL_TEAMS[nextMatch.team2]?.name || nextMatch.team2,
                    team1Score: 0, team1Wickets: 0, team1Overs: 0,
                    team2Score: 0, team2Wickets: 0, team2Overs: 0,
                    innings: 1, target: 0, chasingTeam: null,
                    t1WinProb: 0, t2WinProb: 0,
                    status: 'upcoming',
                    venue: '', winner: null,
                    date: new Date().toISOString()
                };
                
                // Set deterministic pre-match odds utilizing calculated Win Probabilities
                const { t1: prob1, t2: prob2 } = getPreMatchProbabilities(nextMatch.team1, nextMatch.team2);
                
                preMatch.t1WinProb = prob1;
                preMatch.t2WinProb = prob2;
                
                preMatch.status = 'upcoming';
                preMatch.statusText = `Win Probability: ${nextMatch.team1} ${prob1.toFixed(0)}%, ${nextMatch.team2} ${prob2.toFixed(0)}%`;
                preMatch.is_betting_open = true;
                
                // Calculate dynamic payout odds for the pre-match using the existing engine
                const tempOdds = calculateOdds({ t1WinProb: prob1, t2WinProb: prob2 });
                preMatch.team1Odds = tempOdds.team1Odds;
                preMatch.team2Odds = tempOdds.team2Odds;
                
                liveDetailed.push(preMatch);
            }
        }

        // 5. Build upcoming list (enrich with team data)
        const upcomingFiltered = upcomingSch.filter(
            m => !liveDetailed.some(ld => ld.cricbuzzId === m.cricbuzzId)
        );
        const upcoming = upcomingFiltered.slice(0, 8).map(m => {
            const d = new Date();
            if (m.matchNumber > 0) {
                const diff = m.matchNumber - 14;
                d.setDate(d.getDate() + Math.max(0, diff));
                d.setHours(19, 30, 0, 0); // Approx 7:30 PM IST
            }
            return {
                id: `cb_${m.cricbuzzId}`,
                cricbuzzId: m.cricbuzzId,
                matchNumber: m.matchNumber,
                team1: m.team1,
                team2: m.team2,
                team1Name: IPL_TEAMS[m.team1]?.name || m.team1,
                team2Name: IPL_TEAMS[m.team2]?.name || m.team2,
                status: 'upcoming',
                statusText: m.statusText,
                date: d.toISOString(),
                venue: ''
            };
        });

        // 6. Build completed list from recently completed
        const completed = [];
        for (const m of completedSch.slice(-3)) {
            const detail = await scrapeMatchDetail(m.cricbuzzId, true);
            if (detail) {
                detail.status = 'completed';
                detail.is_betting_open = false;
                completed.push(detail);
            }
        }

        return {
            live: liveDetailed,
            completed,
            upcoming,
            demoMode: false
        };
    } catch (err) {
        console.error('[IPL Scraper] getActiveMatches error:', err.message);
        return { live: [], completed: [], upcoming: [], demoMode: false };
    }
}

/**
 * Should the scraper be running right now?
 * Only during IPL match time windows: 2:00 PM – 11:59 PM IST.
 */
function shouldScrapeNow() {
    const now = new Date();
    const utcH = now.getUTCHours();
    const utcM = now.getUTCMinutes();
    const istMins = (utcH * 60 + utcM) + 330; // IST = UTC+5:30
    const istHour = Math.floor((istMins % 1440) / 60);
    return istHour >= 14 || istHour < 3;
}

module.exports = {
    IPL_TEAMS,
    TEAM_KEYS,
    getActiveMatches,
    calculateOdds,
    shouldScrapeNow,
    fetchIPLSchedule
};
