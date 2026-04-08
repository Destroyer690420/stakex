const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function scrapeLogos() {
    // We get the list of team URLs from the points table or teams page
    const res = await axios.get('https://www.cricbuzz.com/cricket-series/9241/indian-premier-league-2026/points-table', {headers: {'User-Agent': 'Mozilla/5.0'}});
    const $ = cheerio.load(res.data);
    const urls = [];
    $('a.cb-text-link').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('/cricket-team/')) {
            urls.push('https://www.cricbuzz.com' + href);
        }
    });

    const uniqueUrls = [...new Set(urls)];
    const db = {};

    for (let u of uniqueUrls) {
        try {
            const teamRes = await axios.get(u, {headers: {'User-Agent': 'Mozilla/5.0'}});
            const team$ = cheerio.load(teamRes.data);
            const logo = team$('img').filter((i, el) => $(el).attr('src')?.includes('a/img/v1')).first().attr('src');
            const name = team$('h1').text().trim();
            if (logo && name) {
                db[name] = logo.startsWith('//') ? 'https:' + logo : logo;
            }
        } catch(e) {}
    }
    console.log(JSON.stringify(db, null, 2));
}

scrapeLogos();
