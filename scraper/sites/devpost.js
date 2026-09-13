const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devpost using their internal API
 */
async function scrapeDevpost() {
  console.log('Scraping Devpost...');
  const hackathons = [];
  try {
    const res = await axios.get('https://devpost.com/api/hackathons');
    const items = res.data?.hackathons || [];
    
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
  } catch (error) {
    console.error('Devpost Scrape Error:', error.message);
  }
  return hackathons;
}

module.exports = { scrapeDevpost };
