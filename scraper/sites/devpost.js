const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devpost using their internal API
 */
async function scrapeDevpost() {
  console.log('Scraping Devpost...');
  const hackathons = [];
  try {
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      console.log(`Fetching Devpost page ${page}...`);
      const res = await axios.get('https://devpost.com/api/hackathons', {
        params: {
          'challenge_type[]': 'online',
          'open_to[]': 'public',
          'status[]': ['upcoming', 'open'],
          order_by: 'deadline',
          page: page
        }
      });
      
      const items = res.data?.hackathons || [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }
      
      for (let item of items) {
        const h = {
          name: item.title,
          source: 'devpost',
          sourceUrl: item.url,
          startDate: item.submission_period_dates ? item.submission_period_dates.split(' - ')[0] : null,
          endDate: item.submission_period_dates ? item.submission_period_dates.split(' - ')[1] : null,
          location: (item.displayed_location && typeof item.displayed_location === 'object') ? item.displayed_location.location : (item.displayed_location || 'Online'),
          organizer: null,
          tags: item.themes ? item.themes.map(t => t.name) : [],
          description: item.description || ''
        };
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
      
      if (items.length < 20 || page >= 20) {
        hasMore = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    console.error('Devpost Scrape Error:', error.message);
  }
  return hackathons;
}

module.exports = { scrapeDevpost };
