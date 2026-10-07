const { isHackathon } = require('../utils/hackathonType');
const { classifyAttendance, contentText } = require('../utils/eventPolicy');
const { parseDateToYMD } = require('../utils/pageParser');
const { localDay } = require('../utils/calendarPolicy');
const { getWithRetry, sleep } = require('../utils/http');

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

// Only what the organiser wrote about each round. The round objects also carry
// Unstop's own SEO copy and URLs, where "Offline Round" names a round held off
// the platform rather than one attended in person.
function roundText(comp) {
  return roundDetails(comp)
    .map(d => [d.roundTitle, d.title, d.description, d.display_text].filter(Boolean).join('\n'))
    .concat((Array.isArray(comp.rounds) ? comp.rounds : [])
      .flatMap(r => (Array.isArray(r.submission_types) ? r.submission_types : []).map(t => `${t.title || ''}\n${t.remarks || ''}`)))
    .join('\n');
}

const sourceLink = (comp, id) => {
  const path = comp.seo_url || comp.public_url;
  if (!path) return `https://unstop.com/hackathons/${id}`;
  return path.startsWith('http') ? path : `https://unstop.com/${path.replace(/^\//, '')}`;
};

/**
 * Turns one Unstop competition record into a hackathon, or names the reason
 * it was left out so a run can report what it skipped instead of hiding it.
 * @returns {{event: Object}|{skipped: string}}
 */
function parseUnstopCompetition(comp, { id = comp?.id, today = localDay(new Date()) } = {}) {
  if (!comp || !comp.title) return { skipped: 'no-details' };

  // 1. Name
  const name = comp.title;
  const content = `${comp.details || ''}\n${roundText(comp)}`;
  if (!isHackathon({ name }, content)) return { skipped: 'not-a-hackathon' };

  // 2. Days Left & Registration Closing Date
  const remainDaysText = comp.regnRequirements?.remain_days ||
    (comp.regnRequirements?.remainingDaysArray ? `${comp.regnRequirements.remainingDaysArray.durations} ${comp.regnRequirements.remainingDaysArray.text}` : null);

  const { registrationDeadline: regClosingDate, eventConductedDate, eventEndDate } = resolveUnstopDates(comp);
  if (!regClosingDate) return { skipped: 'no-registration-deadline' };

  // Filter: only events whose registration deadline is today or in the future
  if (regClosingDate < today) return { skipped: 'registration-closed' };

  // 3. Place / Location
  const address = comp.address_with_country_logo;
  let location = 'Online';
  let mode = 'online';

  const regionLower = (comp.region || '').toLowerCase();
  const locLower = (comp.location || '').toLowerCase();
  const isOffline = regionLower === 'offline' || locLower.includes('offline') || Boolean(address?.city);
  const isBoth = (regionLower === 'both' || locLower.includes('both')) || (isOffline && (regionLower.includes('online') || locLower.includes('online')));
  const venue = [address?.city, address?.state].filter(Boolean).join(', ');

  if (isBoth) {
    mode = 'both';
    location = venue || comp.location || 'Hybrid';
  } else if (isOffline) {
    mode = 'offline';
    location = venue || comp.location || 'In-person';
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

  const h = {
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
    sourceUrl: sourceLink(comp, id),
    source: 'unstop'
  };

  return { event: classifyAttendance(h, `${content} ${contentText(comp.stages)}`) };
}

const REQUEST = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json'
  },
  family: 4,
  timeout: 10000
};

/**
 * Scrapes Unstop hackathons across all pagination pages for:
 * https://unstop.com/hackathons?oppstatus=open
 *
 * Every listing page Unstop reports is visited: pages are routinely shorter
 * than per_page, so a short page says nothing about being the last one. A
 * page or competition that still fails after retries is counted and reported
 * rather than ending the scan or vanishing silently.
 *
 * @returns {Promise<Array>} hackathons, with a `stats` property describing the scan
 */
async function scrapeUnstop({ retryDelayMs = 1000 } = {}) {
  console.log('Scraping Unstop (https://unstop.com/hackathons?oppstatus=open)...');
  const hackathons = [];
  const stats = { source: 'unstop', listed: 0, failedPages: 0, failedDetails: 0, skipped: {}, complete: false };
  hackathons.stats = stats;
  const retry = { delayMs: retryDelayMs };

  let lastPage = null;
  const opportunityIds = [];
  const seenIds = new Set();

  // Step 1: Discover hackathons across search pages 1, 2, 3...
  for (let page = 1; page <= (lastPage || 1); page++) {
    console.log(`Fetching Unstop search page ${page}${lastPage ? `/${lastPage}` : ''}...`);
    const searchUrl = `https://unstop.com/api/public/opportunity/search-result?opportunity=hackathons&page=${page}&per_page=15&oppstatus=open`;
    let res;
    try {
      res = await getWithRetry(searchUrl, REQUEST, retry);
    } catch (error) {
      stats.failedPages++;
      console.error(`Unstop search page ${page} failed: ${error.response?.status || error.code || error.message}`);
      continue;
    }

    const reportedLastPage = Number(res.data?.data?.last_page);
    if (Number.isInteger(reportedLastPage) && reportedLastPage > 0) {
      lastPage = Math.max(lastPage || 0, reportedLastPage);
    }

    for (const item of res.data?.data?.data || []) {
      if (item.id && !seenIds.has(item.id)) {
        seenIds.add(item.id);
        opportunityIds.push(item.id);
      }
    }
    await sleep(100);
  }

  stats.listed = opportunityIds.length;
  console.log(`Found ${opportunityIds.length} open Unstop hackathons across ${lastPage || 0} pages. Visiting each exact page...`);

  const today = localDay(new Date());

  // Step 2: Visit each hackathon's exact page & competition details
  for (const id of opportunityIds) {
    try {
      const detailRes = await getWithRetry(`https://unstop.com/api/public/competition/${id}`, REQUEST, retry);
      const result = parseUnstopCompetition(detailRes.data?.data?.competition, { id, today });
      if (result.event) hackathons.push(result.event);
      else stats.skipped[result.skipped] = (stats.skipped[result.skipped] || 0) + 1;
    } catch (detailErr) {
      stats.failedDetails++;
      console.error(`Unstop competition ${id} failed: ${detailErr.response?.status || detailErr.code || detailErr.message}`);
    }

    // Respectful pause between API calls
    await sleep(60);
  }

  // No listing page reporting a page count means the scan saw nothing at all.
  stats.complete = Boolean(lastPage) && stats.failedPages === 0 && stats.failedDetails === 0;
  const skipped = Object.entries(stats.skipped).map(([reason, count]) => `${count} ${reason}`).join(', ');
  console.log(`Extracted ${hackathons.length} hackathons from ${stats.listed} Unstop listings` +
    `${skipped ? ` (skipped: ${skipped})` : ''}` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedPages} listing page(s) and ${stats.failedDetails} competition(s) failed.`}`);
  return hackathons;
}

module.exports = { scrapeUnstop, resolveUnstopDates, parseUnstopCompetition };
