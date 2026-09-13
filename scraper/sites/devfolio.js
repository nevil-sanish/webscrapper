const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devfolio hackathons via Devfolio Next.js pre-rendered state and detail API
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio...');
  const hackathons = [];

  try {
    const res = await axios.get('https://devfolio.co/hackathons', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 15000
    });

    const match = res.data.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/);
    let list = [];

    if (match) {
      try {
        const nextData = JSON.parse(match[1]);
        const query = nextData.props?.pageProps?.dehydratedState?.queries?.[0];
        const data = query?.state?.data || {};
        list = [
          ...(data.open_hackathons || []),
          ...(data.upcoming_hackathons || []),
          ...(data.featured_hackathons || [])
        ];
      } catch (parseErr) {
        console.warn('Could not parse Devfolio __NEXT_DATA__:', parseErr.message);
      }
    }

    console.log(`Found ${list.length} active hackathons on Devfolio. Fetching details...`);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (let item of list) {
      if (!item || !item.name) continue;

      // Filter out events that ended in the past
      const endDate = item.ends_at ? new Date(item.ends_at) : null;
      if (endDate && endDate < today) continue;

      let loc = item.is_online ? 'Online' : 'In-person';
      let tagline = null;
      let desc = null;

      if (item.slug) {
        try {
          const detailRes = await axios.get(`https://api.devfolio.co/api/hackathons/${item.slug}`, {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
          });
          if (detailRes.data) {
            if (detailRes.data.location) loc = detailRes.data.location;
            if (detailRes.data.tagline) tagline = detailRes.data.tagline;
            if (detailRes.data.desc) desc = detailRes.data.desc;
          }
        } catch (detailErr) {
          // Fallback to basic info if detail API fails
        }
      }

      let mode = 'online';
      if (item.is_online === false) {
        mode = 'offline';
      } else if (item.is_online && loc && loc.toLowerCase() !== 'online') {
        mode = 'both';
      }

      const sourceUrl = item.slug ? `https://${item.slug}.devfolio.co` : 'https://devfolio.co/hackathons';

      const h = {
        name: item.name,
        startDate: item.starts_at || null,
        endDate: item.ends_at || null,
        registrationDeadline: item.settings?.reg_ends_at || null,
        location: loc,
        mode: mode,
        organizer: tagline || null,
        prize: null,
        eligibility: null,
        tags: Array.isArray(item.themes) ? item.themes.map(t => t.theme?.name).filter(Boolean) : [],
        description: desc ? desc.slice(0, 300) : null,
        sourceUrl: sourceUrl,
        source: 'devfolio'
      };

      h.isKeralaRelevant = checkKeralaRelevance(h);
      hackathons.push(h);

      // Gentle pause
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from Devfolio.`);
  return hackathons;
}

module.exports = { scrapeDevfolio };
