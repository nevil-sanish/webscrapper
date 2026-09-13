const { google } = require('googleapis');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

let calendar = null;
let cachedCalendarSummaries = null;

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
 * Loads all existing upcoming calendar event names into memory for instant duplicate check
 */
async function getExistingCalendarSummaries() {
  if (cachedCalendarSummaries) return cachedCalendarSummaries;
  cachedCalendarSummaries = new Set();
  
  if (!calendar) return cachedCalendarSummaries;

  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 2500,
      singleEvents: true,
    });

    for (let item of res.data.items || []) {
      if (item.summary) {
        cachedCalendarSummaries.add(item.summary.trim().toLowerCase());
      }
    }
  } catch (error) {
    console.error('Error fetching existing calendar events for deduplication:', error.message);
  }

  return cachedCalendarSummaries;
}

/**
 * Creates a single-day calendar event for a hackathon on its start date if it does not already exist.
 * Ignores any hackathon that started in the past.
 * @param {Object} hackathon - The hackathon object
 * @returns {Promise<boolean>} - True if newly added, false if skipped or failed
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

  // Duplicate Check against cached calendar events
  const existingSet = await getExistingCalendarSummaries();
  const normName = hackathon.name.trim().toLowerCase();

  if (existingSet.has(normName)) {
    return false;
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

  // Determine Google Calendar Color:
  // - Offline and Both (online & offline) -> Peacock color ("7")
  // - Online -> Orange color ("6")
  let colorId = '6'; // Tangerine / Orange (default for online)
  const mode = (hackathon.mode || '').toLowerCase().trim();
  const loc = (hackathon.location || '').toLowerCase().trim();

  if (mode === 'offline' || mode === 'both' || mode === 'hybrid' || mode === 'in-person' || mode === 'physical') {
    colorId = '7'; // Peacock
  } else if (loc && loc !== 'online' && !loc.includes('online') && loc !== 'virtual') {
    colorId = '7'; // Peacock
  }

  // Event description with full details
  let desc = `Mode: ${hackathon.mode || 'Unknown'}\n`;
  desc += `Link: ${hackathon.sourceUrl}\n`;
  if (hackathon.startDate) desc += `Start Date: ${new Date(hackathon.startDate).toLocaleDateString()}\n`;
  if (hackathon.endDate) desc += `End Date: ${new Date(hackathon.endDate).toLocaleDateString()}\n`;
  if (hackathon.organizer) desc += `Organizer: ${hackathon.organizer}\n`;
  if (hackathon.prize) desc += `Prize: ${hackathon.prize}\n`;
  if (hackathon.eligibility) desc += `Eligibility: ${hackathon.eligibility}\n`;
  if (hackathon.description) desc += `\n${hackathon.description}`;

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
    console.log(`Event created in Google Calendar for "${hackathon.name}" on ${startDateStr} (color: ${colorId === '7' ? 'Peacock' : 'Orange'}): ${res.data.htmlLink}`);
    existingSet.add(normName);
    return true;
  } catch (error) {
    console.error(`Error creating calendar event for "${hackathon.name}":`, error.response?.data?.error?.message || error.message);
    return false;
  }
}

module.exports = { addEventToCalendar, isCalendarConfigured };
