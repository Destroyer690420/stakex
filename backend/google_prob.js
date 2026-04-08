const axios = require('axios');
const cheerio = require('cheerio');

async function getGoogleProb(t1, t2) {
    try {
        const url = `https://www.google.com/search?q=${t1}+vs+${t2}+win+probability&hl=en`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        require('fs').writeFileSync('google.html', data);
        
        const $ = cheerio.load(data);
        const text = $('body').text();
        
        // Let's attempt to look for "Win probability"
        if (text.includes('win probability') || text.includes('Win probability')) {
           const matches = text.match(/(\d{1,3})%/g);
           console.log("Found percentages:", matches);
           
           // We can also try to look specifically at the text around it
           let snapshot = text.substring(text.indexOf('Win probability') - 50, text.indexOf('Win probability') + 100);
           console.log("Snapshot:", snapshot);
        } else {
           console.log("Not found in body text.");
           // Maybe it's hidden under different casing
           const lowerText = text.toLowerCase();
           const idx = lowerText.indexOf('win probability');
           if (idx > -1) {
               console.log("Found in lower:", text.substring(idx - 50, idx + 100));
           } else {
               const idx2 = lowerText.indexOf('%');
               console.log("First % at:", idx2, text.substring(idx2 - 30, idx2 + 30));
               
               // Look for exact team names nearby percentages
               console.log($('table').text().substring(0, 100));
               console.log($('div[role="heading"]').text());
           }
        }
        
    } catch(err) {
        console.error(err.message);
    }
}
getGoogleProb('KKR', 'LSG');
