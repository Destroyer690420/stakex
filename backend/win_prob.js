const axios = require('axios');
const cheerio = require('cheerio');
axios.get('https://www.cricbuzz.com/live-cricket-scores/149746', {headers:{'User-Agent':'Mozilla/5.0'}})
.then(r => {
    const $ = cheerio.load(r.data);
    let found = '';
    $('span, div').each((i, el) => {
        const t = $(el).text();
        if (t.includes('Win Probability')) {
            found = $(el).parent().text() || $(el).text();
        }
    });
    console.log(found);
});
