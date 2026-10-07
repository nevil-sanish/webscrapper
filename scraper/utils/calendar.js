const { originalName, calendarSummary, isManaged, registrationDeadlineDay, isRegistrationClosed, isPastEvent, fromCalendar, localDay } = require('./calendarPolicy');
const { parseDateToYMD } = require('./pageParser');
const { shouldKeepHackathon } = require('./eventPolicy');
const { keralaPriority } = require('./eventPolicy');
const { google } = require('googleapis');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

let calendar = null;
let cachedCalendarEvents = null;

// A service account key never expires and needs no consent screen, so it is
// preferred over the OAuth refresh token when both are set. The calendar must
// be shared with the service account and named in GOOGLE_CALENDAR_ID: its own
// "primary" calendar is an empty one nobody looks at.
if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/calendar.events']
  });
  calendar = google.calendar({ version: 'v3', auth });
} else if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && REFRESH_TOKEN.trim() !== '') {
  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: REFRESH_TOKEN
  });

  calendar = google.calendar({ version: 'v3', auth: oauth2Client });
}

function isCalendarConfigured() {
  return Boolean(calendar);
}

function getCalendarClient() {
  return calendar;
}

const linkOf = description => String(description || '').match(/^Link:[ \t]*(\S+)/m)?.[1] || '';

/**
 * Loads the upcoming scraper-managed calendar entries, indexed by event link
 * and by name. A failed listing throws: carrying on with an empty index would
 * add every hackathon a second time.
 */
async function getExistingCalendarEvents() {
  if (cachedCalendarEvents) return cachedCalendarEvents;
  const index = { byLink: new Map(), byName: new Map(), claimed: new Set() };
  if (!calendar) return index;

  let pageToken;
  do {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 2500,
      singleEvents: true,
      pageToken,
    });

    for (let item of res.data.items || []) {
      if (item.summary && isManaged(item)) {
        const entry = {
          id: item.id,
          summary: item.summary,
          start: item.start,
          end: item.end,
          colorId: item.colorId,
          description: item.description || ''
        };
        index.byName.set(originalName(item.summary).trim().toLowerCase(), entry);
        if (linkOf(entry.description)) index.byLink.set(linkOf(entry.description), entry);
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  cachedCalendarEvents = index;
  return index;
}

// The link identifies a listing. The name is the fallback for a hackathon found
// through a different source than last time, but an entry already matched in
// this run belongs to another listing that merely shares the name.
function findExisting(index, hackathon) {
  const byLink = hackathon.sourceUrl && index.byLink.get(hackathon.sourceUrl);
  if (byLink) return byLink;
  const byName = index.byName.get(hackathon.name.trim().toLowerCase());
  return byName && !index.claimed.has(byName.id) ? byName : null;
}

function remember(index, hackathon, entry) {
  for (const [link, known] of index.byLink) if (known === entry) index.byLink.delete(link);
  if (hackathon.sourceUrl) index.byLink.set(hackathon.sourceUrl, entry);
  index.byName.set(hackathon.name.trim().toLowerCase(), entry);
  index.claimed.add(entry.id);
}


const SOUTH_INDIA_TERMS = [
  // States & UTs
  'kerala', 'tamil nadu', 'tamilnadu', 'karnataka', 'telangana', 'andhra pradesh', 'andhra', 'puducherry', 'pondicherry',
  // Kerala cities & places
  'kochi', 'cochin', 'ernakulam', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut', 'thrissur', 'trichur',
  'kollam', 'quilon', 'kottayam', 'palakkad', 'palghat', 'kannur', 'cannanore', 'malappuram', 'alappuzha', 'alleppey',
  'kasaragod', 'wayanad', 'idukki', 'pathanamthitta', 'karunagappally', 'kothamangalam', 'nilambur', 'nalanchira', 'thodiyoor',
  // Tamil Nadu cities & places
  'chennai', 'madras', 'coimbatore', 'kovai', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'tirunelveli',
  'erode', 'vellore', 'thanjavur', 'dindigul', 'tiruppur', 'tirupur', 'kanchipuram', 'kancheepuram', 'karur', 'nagercoil',
  'hosur', 'theni', 'sivakasi', 'virudhunagar', 'kattankulathur', 'cuddalore', 'kumbakonam', 'pollachi',
  // Karnataka cities & places
  'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubballi', 'hubli', 'belagavi',
  'belgaum', 'udupi', 'shivamogga', 'shimoga', 'davanagere', 'ballari', 'bellary', 'gulbarga',
  'kalaburagi', 'tumkur', 'tumakuru', 'dharwad', 'bidar', 'hassan',
  // Telangana cities & places
  'hyderabad', 'secunderabad', 'warangal', 'nizamabad', 'karimnagar', 'khammam', 'ramagundam', 'mahbubnagar', 'nalgonda',
  // Andhra Pradesh cities & places
  'visakhapatnam', 'vizag', 'vijayawada', 'guntur', 'nellore', 'kurnool', 'rajahmundry', 'tirupati',
  'kakinada', 'anantapur', 'ananthapur', 'kadapa', 'chittoor', 'amaravati', 'nuzvid', 'srikakulam', 'eluru', 'ongole'
];

const NON_SOUTH_TERMS = [
  'delhi', 'new delhi', 'noida', 'gurugram', 'gurgaon', 'mumbai', 'navi mumbai', 'pune', 'nagpur', 'nashik', 'sangli',
  'maharashtra', 'rajasthan', 'jaipur', 'udaipur', 'jodhpur', 'kota',
  'uttar pradesh', 'lucknow', 'kanpur', 'mathura', 'varanasi', 'ghaziabad', 'meerut', 'agra',
  'madhya pradesh', 'indore', 'bhopal', 'gwalior', 'jabalpur',
  'punjab', 'mohali', 'ludhiana', 'amritsar', 'chandigarh',
  'haryana', 'sonipat', 'panipat', 'rohtak',
  'west bengal', 'kolkata', 'howrah', 'panihati',
  'bihar', 'patna', 'araria', 'sheikhpura',
  'gujarat', 'ahmedabad', 'surat', 'vadodara', 'gandhinagar',
  'odisha', 'orissa', 'bhubaneswar', 'rourkela',
  'chhattisgarh', 'raipur', 'bhilai', 'junwani',
  'jharkhand', 'ranchi', 'jamshedpur',
  'uttarakhand', 'dehradun', 'roorkee', 'pantnagar',
  'himachal pradesh', 'manali', 'shimla', 'hamirpur',
  'goa', 'assam', 'guwahati',
  'germany', 'munich', 'usa', 'seattle', 'redmond', 'washington'
];

/**
 * Checks whether an event location/description/name is located in South India
 */
function isSouthIndia(location, description, name) {
  const loc = (location || '').toLowerCase().trim();

  // If location has South India terms and no non-South state/city terms
  const locHasSouth = SOUTH_INDIA_TERMS.some(t => new RegExp(`\\b${t}\\b`, 'i').test(loc));
  const locHasNonSouth = NON_SOUTH_TERMS.some(t => new RegExp(`\\b${t}\\b`, 'i').test(loc));

  if (locHasSouth && !locHasNonSouth) return true;
  if (locHasNonSouth) return false;

  // Fallback to name and description
  const combined = `${name || ''} ${description || ''}`.toLowerCase();
  const textHasSouth = SOUTH_INDIA_TERMS.some(t => new RegExp(`\\b${t}\\b`, 'i').test(combined));
  const textHasNonSouth = NON_SOUTH_TERMS.some(t => new RegExp(`\\b${t}\\b`, 'i').test(combined));

  if (textHasSouth && !textHasNonSouth) return true;
  return false;
}

/**
 * Determines Google Calendar colorId based on:
 * - Kerala -> Green ('10' Basil)
 * - Other online -> Blue ('9' Blueberry)
 * - Offline -> Red ('11' Tomato)
 */
function getEventColorId(hackathon) {
  if (keralaPriority(hackathon)) return '10';
  const mode = (hackathon.mode || '').toLowerCase().trim();
  const loc = (hackathon.location || '').toLowerCase().trim();

  const isExplicitOnline = mode === 'online' || mode === 'virtual';
  const hasNoPhysicalLoc = !loc || loc === 'online' || loc === 'virtual' || loc === 'remote';

  // Pure online event
  if (isExplicitOnline && hasNoPhysicalLoc) {
    return '9'; // Blueberry (Blue)
  }

  if (hasNoPhysicalLoc && !mode.includes('offline') && !mode.includes('in-person') && !mode.includes('both') && !mode.includes('hybrid')) {
    return '9'; // Blueberry (Blue)
  }

  // Offline or hybrid/both event
  return '11'; // Tomato (Red)
}

function getColorName(colorId) {
  switch (colorId) {
    case '10': return 'Green';
    case '9': return 'Blue';
    case '11': return 'Red';
    default: return colorId;
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Accepts YYYY-MM-DD, ISO timestamps and the Date objects deduplication produces.
function toDay(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : localDay(value);
  return parseDateToYMD(String(value || ''));
}

function addDays(ymd, count) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}

// "23 Sep 2026" - unambiguous, unlike the locale-dependent 9/23/2026.
function formatDay(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/**
 * One all-day entry on the registration deadline, while registration is open.
 * @returns {{start: string, end: string}|null} null when registration closed
 */
function calendarWindow(hackathon, now = new Date()) {
  const deadline = toDay(hackathon.registrationDeadline || hackathon.startDate);
  if (!deadline) return null;
  if (deadline < localDay(now)) return null;

  return { start: deadline, end: addDays(deadline, 1) };
}

/**
 * Creates or updates a one-day all-day entry on the registration deadline.
 * @param {Object} hackathon - The hackathon object
 * @returns {Promise<boolean>} - True if newly added or updated, false if unchanged or skipped
 * @throws when Google Calendar rejects the write, so the run can report it
 */
async function addEventToCalendar(hackathon) {
  if (!calendar) return false;
  if (!hackathon.name) return false;

  const window = calendarWindow(hackathon);
  if (!window) return false;

  const startDateStr = window.start;
  // Google treats an all-day end as exclusive, so the entry ends the day after.
  const nextDayStr = window.end;

  // Kerala green, other online blue, other offline red.
  const colorId = getEventColorId(hackathon);
  const colorName = getColorName(colorId);
  const summary = calendarSummary(hackathon);

  // Event description with full details
  let desc = `Mode: ${hackathon.mode || 'Unknown'}\n`;
  desc += `Location: ${hackathon.location || 'Online'}\n`;
  desc += `Link: ${hackathon.sourceUrl}\n`;
  if (String(hackathon.mode).toLowerCase() === 'online' && hackathon.attendanceEvidence) {
    desc += 'Note: the listing mentions an in-person round without giving a venue - check the event page.\n';
  }
  if (hackathon.fee) desc += `Registration Fee: ${hackathon.fee}\n`;
  if (hackathon.daysLeft) desc += `Days Left: ${hackathon.daysLeft}\n`;

  const deadlineDay = toDay(hackathon.registrationDeadline) || startDateStr;
  desc += `Registration Deadline: ${formatDay(deadlineDay)}\n`;
  const eventStart = toDay(hackathon.eventConductedDate);
  const eventEnd = toDay(hackathon.eventEndDate) || toDay(hackathon.endDate);
  if (eventStart || eventEnd) {
    const first = eventStart || eventEnd;
    const last = eventEnd && eventEnd > first ? eventEnd : null;
    desc += `Event Dates: ${formatDay(first)}${last ? ` - ${formatDay(last)}` : ''}\n`;
  }
  if (hackathon.organizer) desc += `Organizer: ${hackathon.organizer}\n`;
  if (hackathon.prize) desc += `Prize: ${hackathon.prize}\n`;
  if (hackathon.eligibility) desc += `Eligibility: ${hackathon.eligibility}\n`;
  if (hackathon.description) desc += `\n${hackathon.description}`;

  // Check against existing calendar events
  const index = await getExistingCalendarEvents();
  const existing = findExisting(index, hackathon);

  if (existing) {
    remember(index, hackathon, existing);
    const existingDate = (existing.start?.date || existing.start?.dateTime || '').slice(0, 10);
    const existingEnd = (existing.end?.date || existing.end?.dateTime || '').slice(0, 10);
    const existingDesc = (existing.description || '').trim();
    // If the event already exists with the exact same dates, color, and description, skip as duplicate
    if (existingDate === startDateStr && existingEnd === nextDayStr &&
        existing.colorId === colorId && existingDesc === desc.trim() && existing.summary === summary) {
      return false;
    }

    // Otherwise, patch and update the event to the correct registration date, color, and description
    await calendar.events.patch({
      calendarId: CALENDAR_ID,
      eventId: existing.id,
      resource: {
        summary,
        extendedProperties: { private: { managedBy: 'hack-scrapper' } },
        start: { date: startDateStr },
        end: { date: nextDayStr },
        colorId: colorId,
        description: desc,
        location: hackathon.location || 'Online'
      }
    });
    console.log(`Updated Google Calendar event "${hackathon.name}" (${startDateStr}, color: ${colorName})`);
    existing.start = { date: startDateStr };
    existing.end = { date: nextDayStr };
    existing.summary = summary;
    existing.colorId = colorId;
    existing.description = desc;
    return true;
  }

  const event = {
    summary,
    extendedProperties: { private: { managedBy: 'hack-scrapper' } },
    location: hackathon.location || 'Online',
    description: desc,
    colorId: colorId,
    start: {
      date: startDateStr,
    },
    end: {
      date: nextDayStr, // Google Calendar's all-day end date is exclusive.
    },
  };

  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    resource: event,
  });
  console.log(`Event created in Google Calendar for "${hackathon.name}" (${startDateStr}, color: ${colorName}): ${res.data.htmlLink}`);
  remember(index, hackathon, { id: res.data.id, start: { date: startDateStr }, end: { date: nextDayStr }, colorId, summary, description: desc });
  return true;
}

/**
 * Deletes the scraper-managed hackathon events in the configured calendar
 */
async function clearAllCalendarEvents() {
  if (!calendar) {
    console.warn('Calendar is not configured. Cannot clear events.');
    return 0;
  }

  try {
    // Only entries this scraper created: the calendar may be a personal one.
    const items = [];
    let pageToken;
    do {
      const res = await calendar.events.list({
        calendarId: CALENDAR_ID,
        timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 2500,
        singleEvents: true,
        pageToken,
      });
      items.push(...(res.data.items || []).filter(isManaged));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    console.log(`Found ${items.length} hackathon calendar events to remove.`);

    let deletedCount = 0;
    for (const item of items) {
      try {
        await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: item.id
        });
        deletedCount++;
        console.log(`[DELETED] "${item.summary}" (${deletedCount}/${items.length})`);
      } catch (err) {
        console.error(`Error deleting event "${item.summary}":`, err.message);
      }
    }

    cachedCalendarEvents = null;

    console.log(`Successfully removed ${deletedCount} events from Google Calendar.`);
    return deletedCount;
  } catch (error) {
    console.error('Error fetching calendar events to clear:', error.message);
    return 0;
  }
}

// Run before scraping, including when no new events are discovered.
async function maintainCalendar({ now = new Date(), client = calendar, calendarId = CALENDAR_ID } = {}) {
  if (!client) return { deleted: 0, updated: 0 };
  const items = [];
  let pageToken;
  // Deadlines are Indian dates whatever zone the calendar or machine is set to.
  const timeZone = 'Asia/Kolkata';
  do {
    const res = await client.events.list({ calendarId, maxResults: 2500, pageToken, showDeleted: false });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  let deleted = 0;
  let updated = 0;
  let failed = 0;
  for (const item of items) {
    if (!isManaged(item) || item.recurrence || item.recurringEventId) continue;
    const h = fromCalendar(item);
    const reason = isRegistrationClosed(item, now, timeZone) ? 'registration closed' :
      (isPastEvent(item, now, timeZone) ? 'past event' : (!shouldKeepHackathon(h) ? 'outside event policy' : null));
    try {
      if (reason) {
        await client.events.delete({ calendarId, eventId: item.id });
        deleted++;
        console.log(`Removed ${reason}: ${h.name}`);
      } else {
        const summary = calendarSummary(h);
        const colorId = getEventColorId(h);
        const deadline = registrationDeadlineDay(item, timeZone);
        const datesDiffer = deadline &&
          (item.start?.date !== deadline || item.end?.date !== addDays(deadline, 1));
        if (item.summary !== summary || item.colorId !== colorId || datesDiffer) {
          const resource = { summary, colorId,
            extendedProperties: { private: { ...item.extendedProperties?.private, managedBy: 'hack-scrapper' } } };
          if (datesDiffer) {
            resource.start = { date: deadline };
            resource.end = { date: addDays(deadline, 1) };
          }
          await client.events.patch({ calendarId, eventId: item.id, resource });
          updated++;
        }
      }
    } catch (error) {
      failed++;
      console.error(`Calendar maintenance failed for ${h.name}: ${error.code || error.name}`);
    }
  }
  cachedCalendarEvents = null;
  console.log(`Calendar maintenance: ${deleted} removed, ${updated} entries updated.`);
  if (failed) throw new Error(`Calendar maintenance failed for ${failed} event(s)`);
  return { deleted, updated };
}

module.exports = {
  maintainCalendar,
  calendarWindow,
  formatDay,
  addEventToCalendar,
  clearAllCalendarEvents,
  isCalendarConfigured,
  getCalendarClient,
  isSouthIndia,
  getEventColorId,
  getColorName
};
