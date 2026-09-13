const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');
const { parseDateToYMD } = require('../utils/pageParser');

/**
 * Scrapes Unstop hackathons across pagination pages and visits each
 * hackathon's exact competition page/details to extract:
 * 1. name
 * 2. place (location)
 * 3. mode (online, offline, both)
 * 4. registration end date (from the registration closing time interval)
 * 
 * Completely deterministic without any LLM API calls.
 */
async function scrapeUnstop() {
  console.log('Scraping Unstop (Multi-page search + exact hackathon page extraction)...');
  const hackathons = [];
  
  try {
    let page = 1;
    let hasMore = true;
    const maxPages = 6;
    const opportunityIds = [];
    
    // Step 1: Discover hackathons across search pages
    while (hasMore && page <= maxPages) {
      console.log(`Fetching Unstop search page ${page}...`);
      const searchUrl = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=${page}&per_page=15&oppstatus=open&usertype=students&domain=2`;
      
      const res = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        await new Promise(r => setTimeout(r, 200));
      }
    }
    
    console.log(`Found ${opportunityIds.length} Unstop hackathons. Visiting exact pages...`);
    
    const now = new Date();
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Step 2: Visit each hackathon's exact page & competition details
    for (let opp of opportunityIds) {
      try {
        const detailRes = await axios.get(`https://unstop.com/api/public/competition/${opp.id}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          },
          timeout: 8000
        });
        
        const comp = detailRes.data?.data?.competition;
        if (!comp || !comp.title) continue;

        // Extract Registration / Submission Closing Date:
        // 1. Primary: If a LIVE round (e.g. Idea Submission, Screening, Round 1) is active,
        // its end_date is the immediate deadline participants are racing against (e.g. Tejas ends 13 Sep)
        let regClosingDate = null;
        if (Array.isArray(comp.rounds)) {
          for (let r of comp.rounds) {
            if (Array.isArray(r.details)) {
              for (let d of r.details) {
                if (d.status === 'LIVE' && d.end_date) {
                  const candidate = parseDateToYMD(d.end_date);
                  if (candidate && (!regClosingDate || candidate < regClosingDate)) {
                    regClosingDate = candidate;
                  }
                }
              }
            }
          }
        }

        // 2. Secondary: Registration interval from regnRequirements (start_regn_dt -> end_regn_dt)
        if (!regClosingDate && comp.regnRequirements?.end_regn_dt) {
          regClosingDate = parseDateToYMD(comp.regnRequirements.end_regn_dt);
        }

        // 3. Tertiary: Check any rounds with registration / submission titles
        if (!regClosingDate && Array.isArray(comp.rounds)) {
          for (let r of comp.rounds) {
            if (Array.isArray(r.details)) {
              for (let d of r.details) {
                const titleLower = `${d.title || ''} ${r.title || ''}`.toLowerCase();
                if (/registration|regn|apply|application|submission/i.test(titleLower) && d.end_date) {
                  const candidate = parseDateToYMD(d.end_date);
                  if (candidate && (!regClosingDate || candidate < regClosingDate)) {
                    regClosingDate = candidate;
                  }
                }
              }
            }
          }
        }

        // 3. Fallback: datesToshow items
        if (!regClosingDate && Array.isArray(comp.datesToshow)) {
          const regItem = comp.datesToshow.find(d => /registration|regn|apply|round 1/i.test(d.title));
          if (regItem?.important_date) {
            regClosingDate = parseDateToYMD(regItem.important_date);
          }
        }

        // 4. Ultimate fallback: comp.regn_end_date or comp.end_date
        if (!regClosingDate) {
          regClosingDate = parseDateToYMD(comp.regn_end_date || comp.end_date);
        }

        if (!regClosingDate) continue;

        // Filter: only events whose registration deadline is today or in the future
        if (regClosingDate < todayYMD) {
          // Registration closed in the past, skip
          continue;
        }

        // Extract Place & Mode
        const address = comp.address_with_country_logo;
        let location = 'Online';
        let mode = 'online';

        const regionLower = (comp.region || '').toLowerCase();
        const locLower = (comp.location || '').toLowerCase();
        const isOffline = regionLower === 'offline' || locLower.includes('offline') || Boolean(address?.city);
        const isBoth = (regionLower === 'both' || locLower.includes('both')) || (isOffline && (regionLower.includes('online') || locLower.includes('online')));

        if (isBoth) {
          mode = 'both';
          location = address?.city ? `${address.city}${address.state ? ', ' + address.state : ''}` : 'Hybrid';
        } else if (isOffline) {
          mode = 'offline';
          location = address?.city ? `${address.city}${address.state ? ', ' + address.state : ''}` : (comp.location || 'In-person');
        }
        
        let sourceUrl = `https://unstop.com/hackathons/${opp.id}`;
        if (comp.seo_url) {
          sourceUrl = comp.seo_url.startsWith('http') ? comp.seo_url : `https://unstop.com/${comp.seo_url.replace(/^\//, '')}`;
        } else if (comp.public_url) {
          sourceUrl = comp.public_url.startsWith('http') ? comp.public_url : `https://unstop.com/${comp.public_url.replace(/^\//, '')}`;
        }
          
        const h = {
          name: comp.title,
          startDate: regClosingDate,
          endDate: parseDateToYMD(comp.end_date) || regClosingDate,
          registrationDeadline: regClosingDate,
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
        // Skip individual network failure
      }
      
      // Respectful pause between API calls
      await new Promise(r => setTimeout(r, 100));
    }
    
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  }
  
  console.log(`Extracted ${hackathons.length} hackathons from Unstop exact pages.`);
  return hackathons;
}

module.exports = { scrapeUnstop };
