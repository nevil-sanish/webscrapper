const { google } = require('googleapis');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

let calendar = null;
let cachedCalendarEventsMap = null;

if (CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN && REFRESH_TOKEN.trim() !== '') {
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

/**
 * Loads all existing upcoming calendar events into memory for instant duplicate check and date updating
 */
async function getExistingCalendarEventsMap() {
  if (cachedCalendarEventsMap) return cachedCalendarEventsMap;
  cachedCalendarEventsMap = new Map();
  
  if (!calendar) return cachedCalendarEventsMap;

  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 2500,
      singleEvents: true,
    });

    for (let item of res.data.items || []) {
      if (item.summary) {
        cachedCalendarEventsMap.set(item.summary.trim().toLowerCase(), {
          id: item.id,
          summary: item.summary,
          start: item.start,
          end: item.end,
          colorId: item.colorId
        });
      }
    }
  } catch (error) {
    console.error('Error fetching existing calendar events for deduplication:', error.message);
  }

  return cachedCalendarEventsMap;
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
 * - Online all -> Green ('10' Basil)
 * - Offline in South India -> Orange ('6' Tangerine)
 * - Offline other -> Purple ('3' Grape)
 */
function getEventColorId(hackathon) {
  const mode = (hackathon.mode || '').toLowerCase().trim();
  const loc = (hackathon.location || '').toLowerCase().trim();

  const isExplicitOnline = mode === 'online' || mode === 'virtual';
  const hasNoPhysicalLoc = !loc || loc === 'online' || loc === 'virtual' || loc === 'remote';

  // Pure online event
  if (isExplicitOnline && hasNoPhysicalLoc) {
    return '10'; // Basil (Green)
  }

  if (hasNoPhysicalLoc && !mode.includes('offline') && !mode.includes('in-person') && !mode.includes('both') && !mode.includes('hybrid')) {
    return '10'; // Basil (Green)
  }

  // Offline or hybrid/both event
  if (isSouthIndia(hackathon.location, hackathon.description, hackathon.name)) {
    return '6'; // Tangerine (Orange)
  }

  return '3'; // Grape (Purple)
}

function getColorName(colorId) {
  switch (colorId) {
    case '10': return 'Green';
    case '6': return 'Orange';
    case '3': return 'Purple';
    default: return colorId;
  }
}

/**
 * Creates or updates a single-day calendar event for a hackathon on its registration deadline / start date.
 * @param {Object} hackathon - The hackathon object
 * @returns {Promise<boolean>} - True if newly added or updated, false if unchanged or skipped
 */
async function addEventToCalendar(hackathon) {
  if (!calendar) return false;

  if (!hackathon.name || !hackathon.startDate) {
    return false;
  }

  const start = new Date(hackathon.startDate);
  if (isNaN(start.getTime())) {
    return false;
  }

  // Filter: ONLY events that happen today or in the future
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let eventStartDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());

  if (eventStartDay < today) {
    // If the event started earlier, check if it is still ongoing (endDate >= today)
    if (hackathon.endDate) {
      const end = new Date(hackathon.endDate);
      if (!isNaN(end.getTime())) {
        const eventEndDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
        if (eventEndDay >= today) {
          // Active ongoing hackathon - schedule single-day reminder on today
          eventStartDay = today;
        } else {
          // Event completed in the past
          return false;
        }
      } else {
        return false;
      }
    } else {
      // Event started in the past with no future end date, skip
      return false;
    }
  }

  // Format: ONLY for the first day (All-day single-day event)
  const formatYMD = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const startDateStr = formatYMD(eventStartDay);
  const nextDay = new Date(eventStartDay);
  nextDay.setDate(nextDay.getDate() + 1);
  const nextDayStr = formatYMD(nextDay);

  // Determine Google Calendar Color based on criteria:
  // - Online all -> Green ('10')
  // - Offline South India -> Orange ('6')
  // - Offline Other -> Purple ('3')
  const colorId = getEventColorId(hackathon);
  const colorName = getColorName(colorId);

  // Event description with full details
  let desc = `Mode: ${hackathon.mode || 'Unknown'}\n`;
  desc += `Link: ${hackathon.sourceUrl}\n`;
  if (hackathon.registrationDeadline) desc += `Registration Deadline: ${new Date(hackathon.registrationDeadline).toLocaleDateString()}\n`;
  if (hackathon.startDate) desc += `Event Date / Deadline: ${new Date(hackathon.startDate).toLocaleDateString()}\n`;
  if (hackathon.endDate) desc += `End Date: ${new Date(hackathon.endDate).toLocaleDateString()}\n`;
  if (hackathon.organizer) desc += `Organizer: ${hackathon.organizer}\n`;
  if (hackathon.prize) desc += `Prize: ${hackathon.prize}\n`;
  if (hackathon.eligibility) desc += `Eligibility: ${hackathon.eligibility}\n`;
  if (hackathon.description) desc += `\n${hackathon.description}`;

  // Check against existing calendar events
  const existingMap = await getExistingCalendarEventsMap();
  const normName = hackathon.name.trim().toLowerCase();
  const existing = existingMap.get(normName);

  if (existing) {
    const existingDate = (existing.start?.date || existing.start?.dateTime || '').slice(0, 10);
    // If the event already exists with the exact same date and color, skip as duplicate
    if (existingDate === startDateStr && existing.colorId === colorId) {
      return false;
    }

    // Otherwise, patch and update the event to the correct registration date and color
    try {
      await calendar.events.patch({
        calendarId: CALENDAR_ID,
        eventId: existing.id,
        resource: {
          start: { date: startDateStr },
          end: { date: nextDayStr },
          colorId: colorId,
          description: desc,
          location: hackathon.location || 'Online'
        }
      });
      console.log(`Updated Google Calendar event "${hackathon.name}" (date: ${startDateStr}, color: ${colorName})`);
      existing.start = { date: startDateStr };
      existing.colorId = colorId;
      return true;
    } catch (err) {
      console.error(`Error updating calendar event for "${hackathon.name}":`, err.message);
      return false;
    }
  }

  const event = {
    summary: hackathon.name,
    location: hackathon.location || 'Online',
    description: desc,
    colorId: colorId,
    start: {
      date: startDateStr,
    },
    end: {
      date: nextDayStr, // Next day ensures it appears ONLY on the start day in Google Calendar
    },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
    });
    console.log(`Event created in Google Calendar for "${hackathon.name}" on ${startDateStr} (color: ${colorName}): ${res.data.htmlLink}`);
    existingMap.set(normName, { id: res.data.id, start: { date: startDateStr }, colorId });
    return true;
  } catch (error) {
    console.error(`Error creating calendar event for "${hackathon.name}":`, error.response?.data?.error?.message || error.message);
    return false;
  }
}

/**
 * Deletes all hackathon calendar events in the configured calendar
 */
async function clearAllCalendarEvents() {
  if (!calendar) {
    console.warn('Calendar is not configured. Cannot clear events.');
    return 0;
  }

  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 2500,
      singleEvents: true,
    });

    const items = res.data.items || [];
    console.log(`Found ${items.length} calendar events to remove.`);

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

    if (cachedCalendarEventsMap) {
      cachedCalendarEventsMap.clear();
    }

    console.log(`Successfully removed ${deletedCount} events from Google Calendar.`);
    return deletedCount;
  } catch (error) {
    console.error('Error fetching calendar events to clear:', error.message);
    return 0;
  }
}

module.exports = {
  addEventToCalendar,
  clearAllCalendarEvents,
  isCalendarConfigured,
  isSouthIndia,
  getEventColorId,
  getColorName
};
