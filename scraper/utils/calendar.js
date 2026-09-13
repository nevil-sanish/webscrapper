const { google } = require('googleapis');
require('dotenv').config();

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

let calendar = null;

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
 * Creates a calendar event for a hackathon if it does not already exist.
 * @param {Object} hackathon - The hackathon object
 * @returns {Promise<boolean>} - True if newly added, false if skipped or failed
 */
async function addEventToCalendar(hackathon) {
  if (!calendar) {
    return false;
  }

  if (!hackathon.name || !hackathon.startDate) {
    console.warn(`Skipping calendar event for "${hackathon.name || 'Unnamed'}": Missing name or start date.`);
    return false;
  }

  const start = new Date(hackathon.startDate);
  const end = hackathon.endDate ? new Date(hackathon.endDate) : start;

  // Add event details
  let desc = `Mode: ${hackathon.mode || 'Unknown'}\n`;
  desc += `Link: ${hackathon.sourceUrl}\n`;
  if (hackathon.organizer) desc += `Organizer: ${hackathon.organizer}\n`;
  if (hackathon.prize) desc += `Prize: ${hackathon.prize}\n`;
  if (hackathon.eligibility) desc += `Eligibility: ${hackathon.eligibility}\n`;
  if (hackathon.description) desc += `\n${hackathon.description}`;

  const event = {
    summary: hackathon.name,
    location: hackathon.location || 'Online',
    description: desc,
    start: {
      date: start.toISOString().split('T')[0],
    },
    end: {
      date: end.toISOString().split('T')[0],
    },
  };

  try {
    // Check if event with this name already exists in Google Calendar
    const existing = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      q: hackathon.name,
      singleEvents: true,
      maxResults: 10,
    });

    const isDuplicate = existing.data.items?.some(e => {
      return e.summary && e.summary.toLowerCase().trim() === hackathon.name.toLowerCase().trim();
    });

    if (isDuplicate) {
      console.log(`Calendar event already exists for "${hackathon.name}", skipping duplicate.`);
      return false;
    }

    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: event,
    });
    console.log(`Event created in Google Calendar for "${hackathon.name}": ${res.data.htmlLink}`);
    return true;
  } catch (error) {
    console.error(`Error creating calendar event for "${hackathon.name}":`, error.response?.data?.error?.message || error.message);
    return false;
  }
}

module.exports = { addEventToCalendar, isCalendarConfigured };
