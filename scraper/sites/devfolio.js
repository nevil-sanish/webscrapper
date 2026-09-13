const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devfolio using their internal API
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio...');
  const hackathons = [];
  try {
    // Devfolio search API
    const response = await axios.post('https://api.devfolio.co/api/search/hackathons', {
      type: "application/json"
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // The actual response format might vary, but usually they return an array of hits
    // If the API signature is different in 2024, this might need updating. 
    // This is a best-effort based on typical Devfolio API structure.
    const hits = response.data?.hits || [];

    for (let hit of hits) {
      const h = {
        name: hit.name,
        source: 'devfolio',
        sourceUrl: hit.hackathon_setting?.subdomain ? `https://${hit.hackathon_setting.subdomain}.devfolio.co` : 'https://devfolio.co',
        startDate: hit.starts_at || null,
        endDate: hit.ends_at || null,
        registrationDeadline: hit.applications_close_at || null,
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
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }
  return hackathons;
}

module.exports = { scrapeDevfolio };
