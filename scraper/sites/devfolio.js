const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devfolio hackathons via the official Devfolio search API
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio...');
  const hackathons = [];
  
  try {
    let from = 0;
    const size = 30;
    let hasMore = true;
    let pageCount = 0;
    const maxPages = 5;
    
    while (hasMore && pageCount < maxPages) {
      console.log(`Fetching Devfolio API (from ${from})...`);
      const response = await axios.post('https://api.devfolio.co/api/search/hackathons', {
        filter: {
          status: ["open", "upcoming"]
        },
        from: from,
        size: size
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      const hits = response.data?.hits?.hits || [];
      if (hits.length === 0) {
        hasMore = false;
        break;
      }

      for (let item of hits) {
        const hit = item._source;
        if (!hit || !hit.name) continue;

        const subdomain = hit.hackathon_setting?.subdomain || hit.subdomain;
        const sourceUrl = subdomain ? `https://${subdomain}.devfolio.co` : 'https://devfolio.co/hackathons';
        
        let mode = 'online';
        if (hit.is_online === false) {
          mode = 'offline';
        } else if (hit.is_online && hit.location) {
          mode = 'both';
        }

        const h = {
          name: hit.name,
          startDate: hit.starts_at || null,
          endDate: hit.ends_at || null,
          registrationDeadline: hit.reg_ends_at || null,
          location: hit.location || (hit.is_online ? 'Online' : 'India'),
          mode: mode,
          organizer: hit.tagline || null,
          prize: hit.prizes?.length ? hit.prizes.map(p => p.name).slice(0, 3).join(', ') : null,
          eligibility: null,
          tags: [],
          description: hit.desc ? hit.desc.slice(0, 300) : null,
          sourceUrl: sourceUrl,
          source: 'devfolio'
        };

        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
      
      if (hits.length < size) { 
        hasMore = false;
      } else {
        from += size;
        pageCount++;
        await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from Devfolio.`);
  return hackathons;
}

module.exports = { scrapeDevfolio };
