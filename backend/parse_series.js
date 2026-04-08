const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('series.html', 'utf8');
const $ = cheerio.load(html);

const out = [];
$('a[href*="/live-cricket-scores/"]').each((i, el) => {
    out.push({
        text: $(el).text().trim(),
        href: $(el).attr('href'),
        parentClasses: $(el).parent().attr('class')
    });
});
fs.writeFileSync('series_parsed.json', JSON.stringify(out, null, 2));
