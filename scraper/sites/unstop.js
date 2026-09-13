const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Unstop using their internal JSON API
 */
async function scrapeUnstop() {
  console.log('Scraping Unstop (via JSON API)...');
  const hackathons = [];
  try {
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const url = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=${page}&per_page=15&oppstatus=open&usertype=students&domain=2`;
      
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      
      const items = res.data?.data?.data || [];
      
      if (items.length === 0) {
        hasMore = false;
        break;
      }
      
      for (let item of items) {
        const h = {
          name: item.title,
          source: 'unstop',
          sourceUrl: item.public_url || (item.seo_url ? `https://unstop.com/${item.seo_url}` : null),
          startDate: item.start_date || null,
          endDate: item.end_date || null,
          location: item.address_with_country_logo ? item.address_with_country_logo.city : 'Online',
          organizer: item.organisation ? item.organisation.name : null,
          tags: item.required_skills ? item.required_skills.map(s => s.skill) : [],
          description: item.details || ''
        };
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
      
      // Stop condition: if fewer than 15 items were returned, or we hit 20 pages max
      if (items.length < 15 || page >= 20) {
        hasMore = false;
      } else {
        page++;
        // Small delay to prevent aggressive rate limiting
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  }
  return hackathons;
}

module.exports = { scrapeUnstop };
