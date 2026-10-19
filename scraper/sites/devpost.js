const axios = require('axios');
const cheerio = require('cheerio');
const { parseDateToYMD } = require('../utils/pageParser');
const { shouldKeepHackathon, keralaPriority } = require('../utils/eventPolicy');
const { localDay } = require('../utils/calendarPolicy');
const { withRetry } = require('../utils/http');

const SEARCH_URL = 'https://devpost.com/api/hackathons';
// Devpost answers 403 to a bare "Mozilla/5.0"; it wants a complete browser string.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// Devpost lists hundreds of hackathons. Only the biggest prize pools are kept,
// plus anything run by a well-known company whatever its prize.
const TOP_BY_PRIZE = 20;
const TOP_COMPANIES = [
  'google', 'microsoft', 'meta', 'amazon', 'aws', 'apple', 'nvidia', 'openai', 'anthropic', 'ibm', 'intel', 'amd',
  'oracle', 'salesforce', 'adobe', 'paypal', 'gitlab', 'github', 'cloudflare', 'stripe', 'atlassian', 'databricks',
  'snowflake', 'mongodb', 'samsung', 'qualcomm', 'cisco', 'uber', 'netflix', 'twilio', 'vercel', 'hugging face',
  'elastic', 'redis', 'okta', 'auth0', 'shopify', 'linkedin', 'spotify', 'tiktok', 'bytedance', 'sony', 'dell',
  'hp', 'vmware', 'red hat', 'deepmind', 'mistral', 'perplexity', 'notion', 'figma', 'slack', 'zoom', 'visa', 'mastercard'
];
// ponytail: fixed rough rates, only used to rank prizes against each other.
const TO_USD = { '$': 1, '€': 1.08, '£': 1.27, '₹': 1 / 83 };
const isTopCompany = name => TOP_COMPANIES.some(c => new RegExp(`\\b${c}\\b`, 'i').test(name || ''));

function listingDeadline(listing, now) {
  const days = String(listing.time_left_to_submission || '').match(/\b(\d+)\s+days?\s+left\b/i);
  if (days) {
    const date = new Date(`${localDay(now)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days[1]));
    return date.toISOString().slice(0, 10);
  }
  // Devpost uses approximate labels such as "about 1 month left". The
  // listing also shows an exact end date for those cards.
  const endText = String(listing.submission_period_dates || '').split(/\s+-\s+/).pop();
  return parseDateToYMD(endText);
}

function cashPrize(listing) {
  if (listing.prizes_counts?.cash === 0) return null;
  const amount = cheerio.load(String(listing.prize_amount || '')).text().trim();
  const match = amount.match(/([$₹€£])\s*([\d,]+(?:\.\d+)?)/);
  if (!match || Number(match[2].replace(/,/g, '')) <= 0) return null;
  return { text: `${match[1]}${match[2]}`, usd: Number(match[2].replace(/,/g, '')) * TO_USD[match[1]] };
}

function parseDevpostListing(listing, now = new Date()) {
  if (!listing?.title || !listing.url) return null;
  const prize = cashPrize(listing);
  const deadline = listingDeadline(listing, now);
  if (!deadline || deadline < localDay(now)) return null;

  const shownLocation = String(listing.displayed_location?.location || '').trim();
  const online = listing.displayed_location?.icon === 'globe' || /^online$/i.test(shownLocation);
  // Only online hackathons need a cash prize. An offline one in Kerala, Tamil
  // Nadu or Karnataka is kept whatever it offers.
  if (online && !prize) return null;
  const event = {
    name: listing.title.trim(),
    source: 'devpost',
    sourceUrl: listing.url,
    mode: online ? 'online' : 'offline',
    location: online ? 'Online' : shownLocation,
    attendanceAnalyzed: true,
    startDate: deadline,
    endDate: deadline,
    registrationDeadline: deadline,
    daysLeft: listing.time_left_to_submission || null,
    prize: prize?.text || null,
    prizeUsd: prize?.usd || 0,
    organization: listing.organization_name || null,
    isKeralaRelevant: Boolean(keralaPriority({ location: shownLocation }))
  };
  return shouldKeepHackathon(event) ? event : null;
}

async function scrapeDevpost({ client = axios, now = new Date(), retryDelayMs = 1000 } = {}) {
  console.log('Scraping Devpost public open and upcoming hackathons...');
  const events = [];
  const stats = { source: 'devpost', listed: 0, failedPages: 0, complete: false };
  events.stats = stats;
  const seen = new Set();
  let totalPages = 1;

  for (let page = 1; page <= totalPages; page++) {
    const url = new URL(SEARCH_URL);
    for (const type of ['online', 'in-person']) url.searchParams.append('challenge_type[]', type);
    url.searchParams.append('open_to[]', 'public');
    url.searchParams.append('status[]', 'upcoming');
    url.searchParams.append('status[]', 'open');
    url.searchParams.set('page', String(page));

    // One page that keeps failing must not discard the pages already read.
    let response;
    try {
      response = await withRetry(() => client.get(url.toString(), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeout: 15000
      }), { delayMs: retryDelayMs });
    } catch (error) {
      stats.failedPages++;
      console.error(`Devpost page ${page} failed: ${error.response?.status || error.code || error.message}`);
      continue;
    }
    const data = response.data || {};
    stats.listed += (data.hackathons || []).length;
    const total = Number(data.meta?.total_count);
    const perPage = Number(data.meta?.per_page);
    if (Number.isInteger(total) && total >= 0 && Number.isInteger(perPage) && perPage > 0) {
      totalPages = Math.max(totalPages, Math.ceil(total / perPage));
    }
    console.log(`Devpost page ${page}/${totalPages}: ${(data.hackathons || []).length} listings`);
    for (const listing of data.hackathons || []) {
      const event = parseDevpostListing(listing, now);
      if (event && !seen.has(event.sourceUrl)) {
        seen.add(event.sourceUrl);
        events.push(event);
      }
    }
  }

  // Every page has to be read first: a top company can sit far down the list.
  events.sort((a, b) => b.prizeUsd - a.prizeUsd);
  // The prize cut is for online hackathons only: offline ones have already
  // passed the Kerala, Tamil Nadu and Karnataka venue rule and are all kept.
  const picked = events.filter((h, i) => i < TOP_BY_PRIZE || isTopCompany(h.organization) || h.mode === 'offline');
  stats.skippedItems = events.filter(h => !picked.includes(h))
    .map(h => ({ name: h.name, url: h.sourceUrl, reason: `prize ${h.prize} is outside the top ${TOP_BY_PRIZE}` }));
  events.splice(0, events.length, ...picked);

  stats.complete = stats.failedPages === 0;
  console.log(`Extracted ${events.length} eligible hackathons from ${stats.listed} Devpost listings` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedPages} listing page(s) failed.`}`);
  return events;
}

module.exports = { scrapeDevpost, parseDevpostListing, isTopCompany };
