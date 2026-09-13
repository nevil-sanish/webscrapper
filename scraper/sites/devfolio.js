const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devfolio open hackathons from https://devfolio.co/hackathons/open
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio (https://devfolio.co/hackathons/open)...');
  const hackathons = [];

  try {
    let from = 0;
    const size = 30;
    let hasMore = true;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    while (hasMore) {
      console.log(`Fetching Devfolio open hackathons (from ${from})...`);
      const response = await axios.post('https://api.devfolio.co/api/search/hackathons', {
        type: 'application_open',
        from: from,
        size: size
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        timeout: 10000
      });

      const hits = response.data?.hits?.hits || [];
      const total = response.data?.hits?.total?.value || 0;

      if (hits.length === 0) {
        hasMore = false;
        break;
      }

      for (let item of hits) {
        const hit = item._source;
        if (!hit || !hit.name) continue;

        // Skip events that completed in the past
        const endDate = hit.ends_at ? new Date(hit.ends_at) : null;
        if (endDate && endDate < today) continue;

        const subdomain = hit.hackathon_setting?.subdomain || hit.subdomain || hit.slug;
        const sourceUrl = subdomain ? `https://${subdomain}.devfolio.co` : 'https://devfolio.co/hackathons/open';

        let loc = hit.location || (hit.is_online ? 'Online' : 'In-person');
        let mode = 'online';
        if (hit.is_online === false) {
          mode = 'offline';
        } else if (hit.is_online && loc && loc.toLowerCase() !== 'online') {
          mode = 'both';
        }

        const prizes = Array.isArray(hit.prizes) && hit.prizes.length > 0 
          ? hit.prizes.map(p => p.name).slice(0, 3).join(', ')
          : null;

        const h = {
          name: hit.name,
          startDate: hit.starts_at || null,
          endDate: hit.ends_at || null,
          registrationDeadline: hit.hackathon_setting?.reg_ends_at || null,
          location: loc,
          mode: mode,
          organizer: hit.tagline || null,
          prize: prizes,
          eligibility: null,
          tags: Array.isArray(hit.themes) ? hit.themes.map(t => t.theme?.name || t.name).filter(Boolean) : [],
          description: hit.desc ? hit.desc.slice(0, 300) : null,
          sourceUrl: sourceUrl,
          source: 'devfolio'
        };

        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }

      from += hits.length;
      if (hits.length < size || from >= total) {
        hasMore = false;
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from Devfolio (https://devfolio.co/hackathons/open).`);
  return hackathons;
}

module.exports = { scrapeDevfolio };
