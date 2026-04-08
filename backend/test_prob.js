const axios = require('axios');
const cheerio = require('cheerio');

async function testProb() {
    try {
        const url = 'https://www.cricbuzz.com/cricket-series/9241/indian-premier-league-2026/matches'; // Just a series link won't have live probability
        // Since I don't know the live match ID right now (the screenshot shows DC vs GT), I will scrape the latest live match API
        const r = await axios.get('https://www.cricbuzz.com/api/cricket-match/leaderboard/series/9241/live');
        // Let's print out what the api returns
        console.log(r.data);
    } catch(e) {
        console.error(e.message);
    }
}

testProb();
