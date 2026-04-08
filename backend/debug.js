const axios = require('axios');
const cheerio = require('cheerio');
async function test() {
    const {data:html} = await axios.get('https://www.cricbuzz.com/cricket-series/9241/indian-premier-league-2026/matches', {headers: {'User-Agent': 'Mozilla/5.0'}});
    const $ = cheerio.load(html);
    const matches = [];
    $('.cb-series-matches').each((_, el) => {
        const linkEl = $(el).find('a[href*="/live-cricket-scores/"]').first();
        if(!linkEl.length) return;
        matches.push({
            href: linkEl.attr('href'),
            text: linkEl.text().trim(),
            date: $(el).find('[itemprop="startDate"]').attr('content') || 'N/A'
        });
    });
    require('fs').writeFileSync('matches.json', JSON.stringify(matches, null, 2));
}
test();
