const { google } = require('googleapis');
const { parseDateToYMD } = require('../utils/pageParser');
const { shouldKeepHackathon, keralaPriority } = require('../utils/eventPolicy');
const { localDay } = require('../utils/calendarPolicy');
const { getGoogleAuth } = require('../utils/calendar');

// The ChaiCoders tracking sheet. Both tabs share one layout: Hackathon,
// Description, Date, Closing Date, Idea, Prize Pool, Location, Registration, Links.
const SHEET_ID = '1WXg2j6eZT5bY7vxIBkQUQaJVEDRMjI5BMOr0I_U7MQc';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const TABS = ['Hackathon', 'claude'];

// "$2,000", "₹1,00,000", "40,000", "75k", "2.8L", "1 Lk", "105000" - but not
// "Prizes for top 3" or "PS5 + Devin Max plans".
const MONEY = /[$₹€£]\s*\d|\d\s*(?:k|l|lk|lakhs?|cr|crores?)\b|\d{1,3}(?:,\d{2,3})+|\d{4,}/i;

async function readTab(tab) {
  const auth = getGoogleAuth();
  if (!auth) throw new Error('Google credentials are not configured');
  const res = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: tab });
  return res.data.values || [];
}

// Returns the event, or a string saying why the row is left out.
function parseSheetRow(row, headers, tab, now = new Date()) {
  const cell = name => String(row[headers.indexOf(name)] ?? '').trim();
  const name = cell('Hackathon');
  if (!name) return 'no name';
  const closing = parseDateToYMD(cell('Closing Date'));
  if (!closing) return 'no closing date';
  if (closing < localDay(now)) return `closing date ${closing} has passed`;

  const shownLocation = cell('Location');
  const prize = cell('Prize Pool');
  const base = {
    name,
    source: 'sheet',
    sourceUrl: cell('Links').match(/https?:\/\/\S+/)?.[0] || '',
    attendanceAnalyzed: true,
    startDate: closing,
    endDate: closing,
    registrationDeadline: closing,
    eventConductedDate: parseDateToYMD(cell('Date')) || undefined,
    prize: prize || undefined,
    description: `From the ${tab} tab of ${SHEET_URL}${shownLocation ? `\nLocation in sheet: ${shownLocation}` : ''}`
  };

  // A venue in Kerala, Tamil Nadu or Karnataka wins, even for an online first
  // round: "Online PPT round -> offline in Mangaluru" is an offline reminder.
  const offline = { ...base, mode: 'offline', location: shownLocation };
  if (shouldKeepHackathon(offline)) return { ...offline, isKeralaRelevant: Boolean(keralaPriority(offline)) };
  if (/\b(?:online|virtual|remote)\b/i.test(shownLocation)) {
    if (!MONEY.test(prize)) return `online without prize money ("${prize}")`;
    return { ...base, mode: 'online', location: 'Online', isKeralaRelevant: false };
  }
  return shownLocation ? `offline outside Kerala/Tamil Nadu/Karnataka ("${shownLocation}")` : 'no location';
}

async function scrapeSheet({ read = readTab, now = new Date() } = {}) {
  console.log('Reading the ChaiCoders hackathon sheet...');
  const events = [];
  const stats = { source: 'sheet', reported: 0, listed: 0, failedPages: 0, skippedItems: [], complete: false };
  events.stats = stats;
  const seen = new Set();

  for (const tab of TABS) {
    let rows;
    try {
      rows = await read(tab);
    } catch (error) {
      stats.failedPages++;
      console.error(`Sheet tab "${tab}" failed: ${error.message}`);
      continue;
    }
    const [headers = [], ...data] = rows;
    for (const row of data) {
      if (!row.some(value => String(value).trim())) continue;
      stats.reported++;
      stats.listed++;
      const result = parseSheetRow(row, headers.map(h => String(h).trim()), tab, now);
      if (typeof result === 'string') {
        stats.skippedItems.push({ name: `${row[headers.indexOf('Hackathon')] || '(blank)'} [${tab}]`, url: '', reason: result });
        continue;
      }
      // The same hackathon can be listed twice, in one tab or across both. The
      // Hackathon tab is read first, so the row that has a link is the one kept.
      const keys = [result.sourceUrl, result.name.toLowerCase()].filter(Boolean);
      if (keys.some(key => seen.has(key))) continue;
      keys.forEach(key => seen.add(key));
      events.push(result);
    }
  }

  stats.complete = stats.failedPages === 0;
  console.log(`Extracted ${events.length} eligible hackathons from ${stats.listed} sheet rows` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedPages} tab(s) failed.`}`);
  return events;
}

module.exports = { scrapeSheet, parseSheetRow };
