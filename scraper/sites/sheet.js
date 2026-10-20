const { google } = require('googleapis');
const cheerio = require('cheerio');
const { parseDateToYMD, parseExactHackathonPage } = require('../utils/pageParser');
const { classifyAttendance, shouldKeepHackathon, plainText, leftOutReason } = require('../utils/eventPolicy');
const { localDay } = require('../utils/calendarPolicy');
const { getGoogleAuth } = require('../utils/calendar');
const { getWithRetry, sleep } = require('../utils/http');
const { parseUnstopCompetition } = require('./unstop');
const { parseDevpostListing } = require('./devpost');
const { resolveRegistrationDeadline, devfolioPrize } = require('./devfolio');

// The ChaiCoders tracking sheet. Only the link column (I) of each row is used:
// every hackathon is read from its own page, never from what the sheet says.
const SHEET_ID = '1WXg2j6eZT5bY7vxIBkQUQaJVEDRMjI5BMOr0I_U7MQc';
const TABS = ['Hackathon', 'claude'];
const LINK_COLUMN = 8;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function readTab(tab) {
  const auth = getGoogleAuth();
  if (!auth) throw new Error('Google credentials are not configured');
  const res = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab });
  return res.data.values || [];
}

const httpGet = (url, accept = 'text/html') =>
  getWithRetry(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, family: 4, timeout: 15000 }, { delayMs: 1000 })
    .then(res => res.data);

async function fromUnstop(url, { get, today }) {
  const id = new URL(url).pathname.match(/-(\d+)\/?$/)?.[1];
  if (!id) return 'no Unstop id in the link';
  const comp = (await get(`https://unstop.com/api/public/competition/${id}`, 'application/json'))?.data?.competition;
  const result = parseUnstopCompetition(comp, { id, today });
  return result.event || result.skipped;
}

async function fromDevpost(url, { get, now }) {
  const sub = new URL(url).hostname.split('.')[0];
  const data = await get(`https://devpost.com/api/hackathons?search=${encodeURIComponent(sub)}`, 'application/json');
  const listing = (data?.hackathons || []).find(h => h.url && new URL(h.url).hostname.split('.')[0] === sub);
  if (!listing) return fromPage(url, { get, now });
  // Same rules as the Devpost scraper: still open, and online ones need a cash prize.
  return parseDevpostListing(listing, now) || `left out by the Devpost rules (${listing.time_left_to_submission || 'closed'})`;
}

async function fromDevfolio(url, { get, now }) {
  const sourceUrl = `https://${new URL(url).hostname}`;
  const $ = cheerio.load(String(await get(sourceUrl)));
  let h;
  try { h = JSON.parse($('#__NEXT_DATA__').html())?.props?.pageProps?.hackathon; } catch (e) {}
  if (!h?.name) return 'no hackathon data on the Devfolio page';
  const bodyText = plainText($('body').html());
  const deadline = resolveRegistrationDeadline({ timerTimestamp: h.settings?.reg_ends_at || h.reg_ends_at, bodyText, now });
  if (!deadline) return 'registration closed';
  const location = h.location || [h.city, h.state].filter(Boolean).join(', ') || (h.is_online ? 'Online' : '');
  return classifyAttendance({
    name: h.name.trim(),
    source: 'devfolio',
    sourceUrl,
    mode: h.settings?.is_hybrid ? 'both' : (h.is_online === false ? 'offline' : 'online'),
    location,
    fee: h.settings?.paid ? (h.settings.fee_amount ? `₹${h.settings.fee_amount}` : 'Paid') : 'Free',
    prize: devfolioPrize(h.prizes),
    startDate: deadline,
    endDate: parseDateToYMD(h.ends_at || '') || deadline,
    registrationDeadline: deadline,
    eventConductedDate: parseDateToYMD(h.starts_at || ''),
    eventEndDate: parseDateToYMD(h.ends_at || ''),
    description: h.desc ? h.desc.slice(0, 300) : null
  }, `${bodyText} ${h.desc || ''}`);
}

// Luma registration stays open until the event starts.
async function fromLuma(url, { get, today }) {
  const slug = new URL(url).pathname.split('/').filter(Boolean).pop();
  const data = await get(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, 'application/json');
  const e = data?.data?.event;
  if (!e?.name) return 'not found on Luma';
  const starts = e.start_at && localDay(new Date(e.start_at), e.timezone || 'Asia/Kolkata');
  if (!starts || starts < today) return 'registration closed';
  const ends = e.end_at && localDay(new Date(e.end_at), e.timezone || 'Asia/Kolkata');
  const offline = e.location_type === 'offline';
  return classifyAttendance({
    name: e.name.trim(),
    source: 'sheet',
    sourceUrl: url,
    mode: offline ? 'offline' : 'online',
    location: offline ? (e.geo_address_info?.full_address || e.geo_address_info?.city_state || '') : 'Online',
    fee: data.data.ticket_info?.is_free === false ? 'Paid' : 'Free',
    startDate: starts,
    endDate: ends || starts,
    registrationDeadline: starts,
    eventConductedDate: starts,
    eventEndDate: ends || null,
    attendanceAnalyzed: true
  });
}

async function fromPage(url, { get, now }) {
  const diagnostics = {};
  const p = parseExactHackathonPage(String(await get(url)), url, { now, diagnostics });
  if (!p) return diagnostics.reason || 'no hackathon found on the page';
  return {
    ...p,
    location: p.place || (p.mode === 'online' ? 'Online' : ''),
    endDate: p.eventEndDate || p.registrationDeadline,
    source: 'sheet'
  };
}

// Returns the event read from the link's own page, or a string saying why there is none.
async function scrapeLink(url, { get = httpGet, now = new Date() } = {}) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const ctx = { get, now, today: localDay(now) };
  if (host === 'unstop.com') return fromUnstop(url, ctx);
  if (host.endsWith('.devpost.com')) return fromDevpost(url, ctx);
  if (host.endsWith('.devfolio.co')) return fromDevfolio(url, ctx);
  if (host === 'luma.com' || host === 'lu.ma') return fromLuma(url, ctx);
  return fromPage(url, ctx);
}

const linkOf = row => String(row[LINK_COLUMN] ?? '').match(/https?:\/\/[^\s,]+/)?.[0];

async function scrapeSheet({ read = readTab, get = httpGet, now = new Date() } = {}) {
  console.log('Reading the links in the ChaiCoders hackathon sheet...');
  const events = [];
  const stats = { source: 'sheet', reported: 0, listed: 0, failedPages: 0, failedDetails: 0, skippedItems: [], complete: false };
  events.stats = stats;

  // The same hackathon is often listed twice, in one tab or across both.
  const links = new Map();
  for (const tab of TABS) {
    let rows;
    try {
      rows = await read(tab);
    } catch (error) {
      stats.failedPages++;
      console.error(`Sheet tab "${tab}" failed: ${error.message}`);
      continue;
    }
    for (const row of rows.slice(1)) {
      const url = linkOf(row);
      if (url && !links.has(url)) links.set(url, `${String(row[0] || '').trim()} [${tab}]`);
    }
  }
  stats.reported = stats.listed = links.size;

  const seen = new Set();
  for (const [url, label] of links) {
    let result;
    try {
      result = await scrapeLink(url, { get, now });
    } catch (error) {
      result = `page could not be read (${error.response?.status || error.code || error.message})`;
    }
    if (typeof result === 'string') {
      stats.skippedItems.push({ name: label, url, reason: result });
    } else if (!shouldKeepHackathon(result)) {
      stats.skippedItems.push({ name: label, url, reason: leftOutReason(result) });
    } else if (!seen.has(result.sourceUrl)) {
      seen.add(result.sourceUrl);
      events.push(result);
    }
    await sleep(100);
  }

  // A link whose page is down or unreadable is reported as skipped, not as a
  // failed run: these are hand-picked sites, not a platform listing.
  stats.complete = stats.failedPages === 0;
  console.log(`Extracted ${events.length} eligible hackathons from ${links.size} sheet links` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedPages} tab(s) failed.`}`);
  for (const item of stats.skippedItems) console.log(`  sheet skipped: ${item.name} - ${item.reason} (${item.url})`);
  return events;
}

module.exports = { scrapeSheet, scrapeLink };
