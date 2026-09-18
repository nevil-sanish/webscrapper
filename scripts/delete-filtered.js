require('dotenv').config();
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Missing calendar credentials");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

const { shouldKeepHackathon } = require('../scraper/utils/eventPolicy');

async function run() {
  console.log('Fetching events to filter and delete...');
  try {
    const res = await calendar.events.list({
      calendarId: CALENDAR_ID,
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      maxResults: 2500,
      singleEvents: true,
    });

    const items = res.data.items || [];
    console.log(`Found ${items.length} calendar events total.`);

    let deletedCount = 0;
    for (const item of items) {
      const summary = item.summary || '';
      const description = item.description || '';
      
      // Only manage scraper-created entries.
      if (!/Mode:/i.test(description) || !/Link:/i.test(description)) continue;

      // Parse Mode
      const modeMatch = description.match(/Mode:\s*(.+)/i);
      const mode = modeMatch ? modeMatch[1].toLowerCase().trim() : '';
      
      // Parse Location
      const locationMatch = description.match(/Location:\s*(.+)/i);
      let location = locationMatch ? locationMatch[1].trim() : (item.location || '');
      
      // Parse Prize
      const prizeMatch = description.match(/Prize:\s*(.+)/i);
      const prize = prizeMatch ? prizeMatch[1].trim() : '';

      const keep = shouldKeepHackathon({ name: summary, description, mode, location });

      if (!keep) {
        console.log(`[DELETING] "${summary}" (Mode: ${mode || 'offline'}, Location: ${location}, Prize: ${prize || 'None'})`);
        try {
          await calendar.events.delete({
            calendarId: CALENDAR_ID,
            eventId: item.id
          });
          deletedCount++;
        } catch (err) {
          console.error(`Error deleting event "${summary}":`, err.message);
        }
      }
    }

    console.log(`Successfully removed ${deletedCount} events that didn't match the new criteria.`);
  } catch (error) {
    console.error('Error fetching calendar events to clear:', error.message);
  }
}

run();
