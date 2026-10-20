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
const { parseHackIndiaPage } = require('./hackindia');

// The ChaiCoders tracking sheet. Each hackathon is read from its linked page.
// Every row of the "Hackathon" tab is pinned: it always goes in the calendar,
// built from the sheet's own row (on its Closing Date) when the page gives no date.
const SHEET_ID = '1WXg2j6eZT5bY7vxIBkQUQaJVEDRMjI5BMOr0I_U7MQc';
const TABS = ['Hackathon', 'claude'];
const PINNED_TAB = 'Hackathon';
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
  if (host === 'hackindia.org') return parseHackIndiaPage(await get(url), url, now);
  return fromPage(url, ctx);
}

const linkOf = row => String(row[LINK_COLUMN] ?? '').match(/https?:\/\/[^\s,]+/)?.[0];
const cell = (row, i) => String(row[i] ?? '').trim();

// A pinned row as the sheet itself states it: name, Closing Date (else Date), venue, prize.
function fromRow(row, url) {
  const deadline = parseDateToYMD(cell(row, 3)) || parseDateToYMD(cell(row, 2));
  if (!deadline) return null;
  const location = cell(row, 6);
  return classifyAttendance({
    name: cell(row, 0).replace(/\s+/g, ' '),
    source: 'sheet',
    sourceUrl: url || `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
    mode: !location || /^(?:fully )?online\b/i.test(location) ? 'online' : 'offline',
    location: location || 'Online',
    prize: cell(row, 5) || null,
    startDate: deadline,
    endDate: parseDateToYMD(cell(row, 2)) || deadline,
    registrationDeadline: deadline,
    eventConductedDate: parseDateToYMD(cell(row, 2)),
    description: cell(row, 1).slice(0, 300) || null,
    attendanceAnalyzed: true
  });
}

async function scrapeSheet({ read = readTab, get = httpGet, now = new Date() } = {}) {
  console.log('Reading the links in the ChaiCoders hackathon sheet...');
  const events = [];
  const stats = { source: 'sheet', reported: 0, listed: 0, failedPages: 0, failedDetails: 0, skippedItems: [], complete: false };
  events.stats = stats;

  // The same hackathon is often listed twice, in one tab or across both.
  // Pinned rows without a link are keyed by name; one that repeats a linked
  // row of the same name ("IQOO Hyderabad" listed twice) is that row.
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
    const pinned = tab === PINNED_TAB;
    const named = rows.slice(1).filter(row => cell(row, 0));
    const sameName = row => named.filter(other => cell(other, 0).toLowerCase() === cell(row, 0).toLowerCase());
    for (let row of named) {
      const url = linkOf(row);
      const key = url || (pinned && `name:${cell(row, 0).toLowerCase()}`);
      if (!key || links.has(key)) continue;
      if (!url && sameName(row).some(linkOf)) continue;
      // A row without dates takes them from its twin ("Bit N Build" is listed
      // once with the link and once with the dates).
      const dated = sameName(row).find(other => cell(other, 3) || cell(other, 2));
      if (dated && !cell(row, 3) && !cell(row, 2)) row = Object.assign([...row], { 2: dated[2], 3: dated[3] });
      links.set(key, { url, row, pinned, label: `${cell(row, 0)} [${tab}]` });
    }
  }
  stats.reported = stats.listed = links.size;

  const seen = new Set();
  for (const { url, row, pinned, label } of links.values()) {
    let result = 'no link in the sheet';
    if (url) {
      try {
        result = await scrapeLink(url, { get, now });
      } catch (error) {
        result = `page could not be read (${error.response?.status || error.code || error.message})`;
      }
    }
    if (pinned) {
      const sheet = fromRow(row, url);
      // The page's own dates win; the sheet fills in what the page could not give.
      if (typeof result !== 'string' && !result.registrationDeadline && sheet) {
        result = { ...result, registrationDeadline: sheet.registrationDeadline, startDate: sheet.startDate };
      }
      if (typeof result === 'string' || !result.registrationDeadline) {
        if (sheet) console.log(`  sheet pinned from its row: ${label} - ${result} (${url || 'no link'})`);
        result = sheet || `pinned but the sheet gives no date (${result})`;
      }
      if (typeof result !== 'string') result = { ...result, pinned: true };
    }
    if (typeof result === 'string') {
      stats.skippedItems.push({ name: label, url, reason: result });
    } else if (!shouldKeepHackathon(result)) {
      stats.skippedItems.push({ name: label, url, reason: leftOutReason(result) });
    } else if (!seen.has(result.sourceUrl)) {
      seen.add(result.sourceUrl);
      events.push(result);
    }
    if (url) await sleep(100);
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
