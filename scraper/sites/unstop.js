const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Unstop hackathons across all pagination pages with deep opportunity detail extraction
 */
async function scrapeUnstop() {
  console.log('Scraping Unstop (Multi-page search + detail extraction)...');
  const hackathons = [];
  
  try {
    let page = 1;
    let hasMore = true;
    const maxPages = 6;
    const opportunityIds = [];
    
    // Step 1: Gather hackathons across all search pages
    while (hasMore && page <= maxPages) {
      console.log(`Fetching Unstop search page ${page}...`);
      const searchUrl = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=${page}&per_page=15&oppstatus=open&usertype=students&domain=2`;
      
      const res = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json'
        },
        timeout: 10000
      });
      
      const items = res.data?.data?.data || [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }
      
      for (let item of items) {
        if (item.id) {
          opportunityIds.push({
            id: item.id,
            seo_url: item.seo_url || item.public_url || ''
          });
        }
      }
      
      if (items.length < 15) {
        hasMore = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, 400));
      }
    }
    
    console.log(`Found ${opportunityIds.length} Unstop hackathons. Fetching full details...`);
    
    // Step 2: Fetch detailed info for each hackathon (mode, city, state, prizes)
    for (let opp of opportunityIds) {
      try {
        const detailRes = await axios.get(`https://unstop.com/api/public/competition/${opp.id}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            'Accept': 'application/json'
          },
          timeout: 8000
        });
        
        const comp = detailRes.data?.data?.competition;
        if (!comp || !comp.title) continue;
        
        const address = comp.address_with_country_logo;
        let location = 'Online';
        let mode = 'online';
        
        const locLower = (comp.location || comp.region || '').toLowerCase();
        if (locLower.includes('offline') || address?.city) {
          mode = locLower.includes('online') ? 'both' : 'offline';
          if (address?.city && address?.state) {
            location = `${address.city}, ${address.state}`;
          } else if (address?.city) {
            location = address.city;
          } else if (address?.state) {
            location = address.state;
          } else {
            location = 'Offline';
          }
        }
        
        let sourceUrl = `https://unstop.com/hackathons/${opp.id}`;
        if (comp.seo_url) {
          sourceUrl = comp.seo_url.startsWith('http') ? comp.seo_url : `https://unstop.com/${comp.seo_url.replace(/^\//, '')}`;
        } else if (comp.public_url) {
          sourceUrl = comp.public_url.startsWith('http') ? comp.public_url : `https://unstop.com/${comp.public_url.replace(/^\//, '')}`;
        }
          
        const h = {
          name: comp.title,
          startDate: comp.start_date || null,
          endDate: comp.end_date || null,
          registrationDeadline: comp.regn_end_date || null,
          location: location,
          mode: mode,
          organizer: comp.organization?.name || null,
          prize: comp.overall_prizes || null,
          eligibility: null,
          tags: Array.isArray(comp.filters) ? comp.filters.map(f => f.name).filter(Boolean) : [],
          description: comp.details ? comp.details.replace(/<[^>]*>/g, ' ').slice(0, 300) : null,
          sourceUrl: sourceUrl,
          source: 'unstop'
        };
        
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      } catch (detailErr) {
        // Skip individual failure
      }
      
      // Gentle pause between API calls
      await new Promise(r => setTimeout(r, 200));
    }
    
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  }
  
  console.log(`Extracted ${hackathons.length} hackathons from Unstop.`);
  return hackathons;
}

module.exports = { scrapeUnstop };
