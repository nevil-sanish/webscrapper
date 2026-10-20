const cheerio = require('cheerio');
const { classifyAttendance, plainText } = require('../utils/eventPolicy');
const { localDay } = require('../utils/calendarPolicy');
const { getWithRetry, sleep } = require('../utils/http');

const BASE = 'https://hackindia.org';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const get = (url, retry) => getWithRetry(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, family: 4, timeout: 15000 }, retry)
  .then(res => String(res.data));

// The listing page is a Next.js app. Event links sit above a "Past Hackathons"
// heading; everything below it is over and is not visited.
function upcomingLinks(html) {
  const $ = cheerio.load(html);
  const links = [];
  let past = false;
  $('h1, h2, h3, a[href]').each((_, el) => {
    if (el.tagName !== 'a') {
      if (/^\s*past hackathons\s*$/i.test($(el).text())) past = true;
      return;
    }
    const href = $(el).attr('href') || '';
    if (!past && /^\/20\d\d\/[\w-]+$/.test(href) && !links.includes(`${BASE}${href}`)) links.push(`${BASE}${href}`);
  });
  return links;
}

// Each event page streams its record (title, dates, venue, prize, fee) in the
// React Server Components payload: the object holding registration_end_date.
function eventRecord(html) {
  const rsc = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map(m => { try { return JSON.parse(`"${m[1]}"`); } catch (e) { return ''; } }).join('');
  const at = rsc.indexOf('"registration_end_date"');
  for (let start = rsc.lastIndexOf('{', at); at >= 0 && start >= 0; start = rsc.lastIndexOf('{', start - 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < rsc.length; i++) {
      const c = rsc[i];
      if (inString) {
        if (c === '\\') i++;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          const record = JSON.parse(rsc.slice(start, i + 1));
          if ('registration_end_date' in record && record.title) return record;
        } catch (e) {}
        break;
      }
    }
  }
  return null;
}

/**
 * Turns one HackIndia event page into a hackathon, or says why there is none.
 * @returns {Object|string}
 */
function parseHackIndiaPage(html, url, now = new Date()) {
  const e = eventRecord(String(html || ''));
  if (!e) return 'no event data on the page';
  if (e.event_type && e.event_type !== 'hackathon') return `not a hackathon (${e.event_type})`;
  if (e.is_cancelled) return 'cancelled';
  if (/closed|completed|ended/i.test(e.status || '')) return `registration closed (${e.status})`;
  const deadline = e.registration_end_date && localDay(new Date(e.registration_end_date));
  if (!deadline || deadline < localDay(now)) return 'registration closed';

  const day = value => (value ? localDay(new Date(value)) : null);
  const venue = [e.location, e.venue_details].filter(Boolean).join(', ');
  const $ = cheerio.load(html);
  const ld = $('script[type="application/ld+json"]').toArray().map(s => $(s).html()).join(' ');
  return classifyAttendance({
    name: e.title.trim(),
    source: 'hackindia',
    sourceUrl: url,
    mode: e.is_online ? 'online' : 'offline',
    location: e.is_online ? 'Online' : venue,
    fee: Number(e.registration_fee) > 0 ? `${e.registration_fee_currency === 'INR' || !e.registration_fee_currency ? '₹' : `${e.registration_fee_currency} `}${e.registration_fee}` : 'Free',
    prize: e.prize_pool || null,
    startDate: deadline,
    endDate: day(e.end_date) || deadline,
    registrationDeadline: deadline,
    eventConductedDate: day(e.start_date),
    eventEndDate: day(e.end_date),
    description: plainText(ld.match(/"description":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\"/g, '"') || '').replace(/\s+/g, ' ').trim().slice(0, 300) || null
  }, e.is_online ? '' : venue);
}

/**
 * Scrapes https://hackindia.org/hackathons: every hackathon listed above the
 * "Past Hackathons" section, each read from its own page.
 * @returns {Promise<Array>} hackathons, with a `stats` property describing the scan
 */
async function scrapeHackIndia({ retryDelayMs = 1000, now = new Date() } = {}) {
  console.log('Scraping HackIndia (https://hackindia.org/hackathons)...');
  const events = [];
  const stats = { source: 'hackindia', reported: null, listed: 0, failedPages: 0, failedDetails: 0, skippedItems: [], complete: false };
  events.stats = stats;
  const retry = { delayMs: retryDelayMs };

  let links;
  try {
    links = upcomingLinks(await get(`${BASE}/hackathons`, retry));
  } catch (error) {
    stats.failedPages++;
    console.error(`HackIndia listing failed: ${error.response?.status || error.code || error.message}`);
    return events;
  }
  stats.reported = stats.listed = links.length;

  for (const url of links) {
    try {
      const result = parseHackIndiaPage(await get(url, retry), url, now);
      if (typeof result === 'string') stats.skippedItems.push({ name: url.split('/').pop(), url, reason: result });
      else events.push(result);
    } catch (error) {
      stats.failedDetails++;
      console.error(`HackIndia page ${url} failed: ${error.response?.status || error.code || error.message}`);
    }
    await sleep(100);
  }

  // No upcoming link at all most likely means the page layout changed.
  stats.complete = links.length > 0 && stats.failedPages === 0 && stats.failedDetails === 0;
  if (!links.length) stats.note = 'no upcoming hackathon links found on the listing page';
  console.log(`Extracted ${events.length} hackathons from ${links.length} upcoming HackIndia listings` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedDetails} event page(s) failed.`}`);
  return events;
}

module.exports = { scrapeHackIndia, parseHackIndiaPage, upcomingLinks };
