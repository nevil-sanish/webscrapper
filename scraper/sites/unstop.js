const axios = require('axios');
const { checkKeralaRelevance } = require('../utils/normalize');
const { extractRegistrationDeadlineFromTimeline } = require('../llm/extract');

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
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Step 2: Fetch detailed info for each hackathon (mode, place, stages and timelines)
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

        const endDate = comp.end_date ? new Date(comp.end_date) : null;
        if (endDate && endDate < today) {
          // Completed in the past, skip
          continue;
        }

        // Build stages & timelines schedule text for LLM analysis
        let timelineText = '';
        if (Array.isArray(comp.rounds)) {
          for (let r of comp.rounds) {
            if (Array.isArray(r.details)) {
              for (let d of r.details) {
                timelineText += `Stage: ${d.title || r.title || 'Round'} | Start: ${d.start_date || 'N/A'} | End: ${d.end_date || 'N/A'}\n`;
              }
            }
          }
        }
        if (Array.isArray(comp.datesToshow)) {
          for (let d of comp.datesToshow) {
            timelineText += `Key Date: ${d.title} on ${d.important_date}\n`;
          }
        }

        // Determine Registration Deadline:
        // 1. If stages timeline exists, pass to LLM to find exact registration / submission closing date
        let regDeadline = null;
        if (timelineText.trim()) {
          regDeadline = await extractRegistrationDeadlineFromTimeline(timelineText, comp.title);
        }

        // 2. Fallback to structured regnRequirements if LLM didn't return a date
        if (!regDeadline) {
          regDeadline = comp.regnRequirements?.end_regn_dt || comp.regn_end_date || null;
        }

        // 3. Fallback to datesToshow registration item or comp.end_date
        if (!regDeadline && Array.isArray(comp.datesToshow)) {
          const regItem = comp.datesToshow.find(d => /registration|regn/i.test(d.title));
          if (regItem?.important_date) {
            regDeadline = regItem.important_date;
          }
        }
        if (!regDeadline) {
          regDeadline = comp.end_date || null;
        }

        if (!regDeadline) continue;
        const deadlineDate = new Date(regDeadline);
        if (isNaN(deadlineDate.getTime())) continue;

        // Filter: only events whose registration deadline is today or in the future
        const deadlineDay = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate());
        if (deadlineDay < today) {
          // Registration closed in the past, skip
          continue;
        }

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
          location = address?.city ? `${address.city}${address.state ? ', ' + address.state : ''}` : 'In-person';
        }
        
        let sourceUrl = `https://unstop.com/hackathons/${opp.id}`;
        if (comp.seo_url) {
          sourceUrl = comp.seo_url.startsWith('http') ? comp.seo_url : `https://unstop.com/${comp.seo_url.replace(/^\//, '')}`;
        } else if (comp.public_url) {
          sourceUrl = comp.public_url.startsWith('http') ? comp.public_url : `https://unstop.com/${comp.public_url.replace(/^\//, '')}`;
        }
          
        const h = {
          name: comp.title,
          startDate: regDeadline,
          endDate: comp.end_date || regDeadline,
          registrationDeadline: regDeadline,
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
      await new Promise(r => setTimeout(r, 150));
    }
    
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  }
  
  console.log(`Extracted ${hackathons.length} hackathons from Unstop.`);
  return hackathons;
}

module.exports = { scrapeUnstop };
