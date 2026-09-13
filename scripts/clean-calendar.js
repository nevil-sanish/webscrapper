require('dotenv').config();
const { google } = require('googleapis');

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_SEARCH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_SEARCH_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || 'primary';

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("Missing calendar credentials in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

async function cleanCalendar() {
  console.log('Fetching multi-day / past spanning events to clean up...');
  
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const res = await calendar.events.list({
    calendarId: CALENDAR_ID,
    timeMin: '2026-08-01T00:00:00Z',
    maxResults: 250,
    singleEvents: true
  });

  const items = res.data.items || [];
  let deletedCount = 0;

  for (let item of items) {
    // Check if this is a scraper-created multi-day spanning event or past event
    const start = item.start?.date || item.start?.dateTime?.split('T')[0];
    const end = item.end?.date || item.end?.dateTime?.split('T')[0];

    // If description contains "Link:" or "Mode:" (created by hack-scrapper)
    const isScraperEvent = item.description && (item.description.includes('Mode:') || item.description.includes('Link:'));
    
    // Check if it started in the past or spans across multiple days
    const isPast = start && start < todayStr;
    const isSpanning = start && end && (new Date(end) - new Date(start) > 24 * 60 * 60 * 1000);

    if (isScraperEvent || (isPast && isSpanning)) {
      try {
        await calendar.events.delete({
          calendarId: CALENDAR_ID,
          eventId: item.id
        });
        console.log(`Deleted: "${item.summary}" (${start} to ${end})`);
        deletedCount++;
        await new Promise(r => setTimeout(r, 100)); // Respect Google API rate limits
      } catch (err) {
        console.error(`Error deleting event "${item.summary}":`, err.message);
      }
    }
  }

  console.log(`\nCleanup complete! Deleted ${deletedCount} multi-day/past events.`);
}

cleanCalendar().catch(console.error);
