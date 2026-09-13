const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devfolio using their internal API
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio...');
  const hackathons = [];
  try {
    let from = 0;
    const size = 20;
    let hasMore = true;
    
    while (hasMore) {
      console.log(`Fetching Devfolio (from ${from})...`);
      // Devfolio search API
      const response = await axios.post('https://api.devfolio.co/api/search/hackathons', {
        type: "application/json",
        filter: {
          status: ["open", "upcoming"]
        },
        from: from,
        size: size
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const hits = response.data?.hits?.hits || [];
      if (hits.length === 0) {
        hasMore = false;
        break;
      }

      for (let item of hits) {
        const hit = item._source;
        if (!hit) continue;

        const h = {
          name: hit.name,
          source: 'devfolio',
          sourceUrl: hit.hackathon_setting?.subdomain ? `https://${hit.hackathon_setting.subdomain}.devfolio.co` : 'https://devfolio.co',
          startDate: hit.starts_at || null,
          endDate: hit.ends_at || null,
          registrationDeadline: hit.hackathon_setting?.reg_ends_at || null,
          location: hit.location || (hit.is_online ? 'Online' : 'Unknown'),
          organizer: hit.organizer_name || null,
          prize: null,
          eligibility: null,
          tags: hit.themes || [],
          description: hit.desc || hit.tagline || ''
        };
        
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
      
      if (hits.length < size || from >= 100) { // Limit to ~100 hackathons
        hasMore = false;
      } else {
        from += size;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }
  return hackathons;
}

module.exports = { scrapeDevfolio };
