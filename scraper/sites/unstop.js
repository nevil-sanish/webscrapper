const { isHackathon } = require('../utils/hackathonType');
const { classifyAttendance, contentText } = require('../utils/eventPolicy');
const axios = require('axios');
const { parseDateToYMD } = require('../utils/pageParser');

/**
 * Unstop exposes several independent date windows per opportunity, and only
 * the registration window says when registration closes. A LIVE submission
 * round normally ends days after registration is shut, so reading its
 * end_date as the deadline advertises a hackathon nobody can still enter.
 * Rounds are used for the deadline only when the registration window itself
 * is missing, and always for the dates the hackathon is actually conducted on.
 */
function roundDetails(comp) {
  return (Array.isArray(comp.rounds) ? comp.rounds : [])
    .flatMap(r => (Array.isArray(r.details) ? r.details : []).map(d => ({ ...d, roundTitle: r.title || '' })));
}

function earliestEnd(details) {
  return details.map(d => parseDateToYMD(d.end_date || '')).filter(Boolean).sort()[0] || null;
}

function resolveUnstopDates(comp) {
  const details = roundDetails(comp);
  const titled = pattern => earliestEnd(details.filter(d => pattern.test(`${d.roundTitle} ${d.title || ''}`)));

  // Early-bird pricing ends before registration does; it is never the deadline.
  const datesToShow = (Array.isArray(comp.datesToshow) ? comp.datesToshow : [])
    .filter(d => /registration|regn|apply|application/i.test(d.title || '') && !/early[ -]?bird/i.test(d.title || ''))
    .map(d => parseDateToYMD(d.important_date || '')).filter(Boolean).sort()[0] || null;

  const registrationDeadline =
    parseDateToYMD(comp.regnRequirements?.end_regn_dt || '') ||
    parseDateToYMD(comp.regn_end_date || '') ||
    titled(/\b(?:registrations?|regn|apply|applications?)\b/i) ||
    datesToShow ||
    titled(/\bsubmissions?\b/i) ||
    earliestEnd(details.filter(d => d.status === 'LIVE')) ||
    parseDateToYMD(comp.end_date || '');

  // The hackathon itself is the last round on the schedule (the finale),
  // not comp.start_date, which is when the opportunity opened.
  const finale = details.reduce((latest, d) =>
    String(d.start_date || '') > String(latest?.start_date || '') ? d : latest, null);

  return {
    registrationDeadline,
    eventConductedDate: parseDateToYMD(finale?.start_date || comp.start_date || comp.starts_at || ''),
    eventEndDate: parseDateToYMD(comp.end_date || finale?.end_date || comp.ends_at || '')
  };
}

/**
 * Scrapes Unstop hackathons across all pagination pages for:
 * https://unstop.com/hackathons?oppstatus=open
 * 
 * For each hackathon, visits its exact page/details to extract:
 * 1. Name (from center part)
 * 2. Mode (from center part: offline, online, both)
 * 3. Place / Location (from center part)
 * 4. Days Left & Registration Deadline (from top right card & live rounds)
 * 5. Registration Fee (from top right card: e.g. ₹ 1,500 or Free)
 */
async function scrapeUnstop() {
  console.log('Scraping Unstop (https://unstop.com/hackathons?oppstatus=open)...');
  const hackathons = [];
  
  try {
    let page = 1;
    let hasMore = true;
    const opportunityIds = [];
    const seenIds = new Set();
    
    // Step 1: Discover hackathons across search pages 1, 2, 3...
    while (hasMore) {
      console.log(`Fetching Unstop search page ${page}...`);
      const searchUrl = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=${page}&per_page=15&oppstatus=open`;
      
      const res = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        family: 4,
        timeout: 10000
      });
      
      const items = res.data?.data?.data || [];
      if (items.length === 0) {
        hasMore = false;
        break;
      }
      
      const previousCount = seenIds.size;
      for (let item of items) {
        if (item.id && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          opportunityIds.push({
            id: item.id,
            seo_url: item.seo_url || item.public_url || ''
          });
        }
      }
      
      if (seenIds.size === previousCount) break;
      const lastPage = res.data?.data?.last_page;
      if ((lastPage && page >= lastPage) || items.length < 15) {
        hasMore = false;
      } else {
        page++;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    console.log(`Found ${opportunityIds.length} open Unstop hackathons across pages. Visiting each exact page...`);
    
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
          family: 4,
          timeout: 10000
        });
        
        const comp = detailRes.data?.data?.competition;
        if (!comp || !comp.title) continue;

        // 1. Name
        const name = comp.title;
        if (!isHackathon({ name }, `${comp.details || ''} ${contentText(comp.rounds)}`)) continue;

        // 2. Days Left & Registration Closing Date
        const remainDaysText = comp.regnRequirements?.remain_days ||
          (comp.regnRequirements?.remainingDaysArray ? `${comp.regnRequirements.remainingDaysArray.durations} ${comp.regnRequirements.remainingDaysArray.text}` : null);

        const { registrationDeadline: regClosingDate, eventConductedDate, eventEndDate } = resolveUnstopDates(comp);

        if (!regClosingDate) continue;

        // Filter: only events whose registration deadline is today or in the future
        if (regClosingDate < todayYMD) {
          continue;
        }

        // 3. Place / Location
        const address = comp.address_with_country_logo;
        let location = 'Online';
        let mode = 'online';

        const regionLower = (comp.region || '').toLowerCase();
        const locLower = (comp.location || '').toLowerCase();
        const isOffline = regionLower === 'offline' || locLower.includes('offline') || Boolean(address?.city);
        const isBoth = (regionLower === 'both' || locLower.includes('both')) || (isOffline && (regionLower.includes('online') || locLower.includes('online')));

        if (isBoth) {
          mode = 'both';
          location = address?.city ? `${address.city}${address.state ? ', ' + address.state : ''}` : (comp.location || 'Hybrid');
        } else if (isOffline) {
          mode = 'offline';
          location = address?.city ? `${address.city}${address.state ? ', ' + address.state : ''}` : (comp.location || 'In-person');
        }

        // 4. Registration Fee (from top right card)
        let fee = 'Free';
        if (Array.isArray(comp.payment_services)) {
          const paidService = comp.payment_services.find(p => p.amount && p.amount > 0);
          if (paidService) {
            fee = `₹${paidService.amount}`;
          }
        }
        if (fee === 'Free' && comp.details) {
          const feeMatch = comp.details.match(/registration fee[s]?\s*[:\-–]?\s*([₹Rs\.]*\s*[\d,]+)/i);
          if (feeMatch) {
            fee = feeMatch[1].trim();
          }
        }
        
        let sourceUrl = `https://unstop.com/hackathons/${opp.id}`;
        if (comp.seo_url) {
          sourceUrl = comp.seo_url.startsWith('http') ? comp.seo_url : `https://unstop.com/${comp.seo_url.replace(/^\//, '')}`;
        } else if (comp.public_url) {
          sourceUrl = comp.public_url.startsWith('http') ? comp.public_url : `https://unstop.com/${comp.public_url.replace(/^\//, '')}`;
        }
          
        let h = {
          name: name,
          startDate: regClosingDate,
          endDate: eventEndDate || regClosingDate,
          registrationDeadline: regClosingDate,
          eventConductedDate,
          eventEndDate,
          location: location,
          mode: mode,
          fee: fee,
          daysLeft: remainDaysText,
          organizer: comp.organization?.name || null,
          prize: comp.overall_prizes || null,
          eligibility: null,
          tags: Array.isArray(comp.filters) ? comp.filters.map(f => f.name).filter(Boolean) : [],
          description: comp.details ? comp.details.replace(/<[^>]*>/g, ' ').slice(0, 300) : null,
          sourceUrl: sourceUrl,
          source: 'unstop'
        };
        
        h = classifyAttendance(h, `${comp.details || ''} ${contentText(comp.rounds)} ${contentText(comp.stages)}`);
        hackathons.push(h);
      } catch (detailErr) {
        // Skip individual network failure
      }
      
      // Respectful pause between API calls
      await new Promise(r => setTimeout(r, 60));
    }
    
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  }
  
  console.log(`Extracted ${hackathons.length} hackathons from Unstop exact pages.`);
  return hackathons;
}

module.exports = { scrapeUnstop, resolveUnstopDates };
