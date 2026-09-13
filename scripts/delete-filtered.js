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

const ALLOWED_STATES_CITIES = [
  'kerala', 'tamil nadu', 'tamilnadu', 'karnataka',
  'kochi', 'cochin', 'ernakulam', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut', 'thrissur', 'trichur',
  'kollam', 'quilon', 'kottayam', 'palakkad', 'palghat', 'kannur', 'cannanore', 'malappuram', 'alappuzha', 'alleppey',
  'kasaragod', 'wayanad', 'idukki', 'pathanamthitta', 'karunagappally', 'kothamangalam', 'nilambur', 'nalanchira', 'thodiyoor',
  'chennai', 'madras', 'coimbatore', 'kovai', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'tirunelveli',
  'erode', 'vellore', 'thanjavur', 'dindigul', 'tiruppur', 'tirupur', 'kanchipuram', 'kancheepuram', 'karur', 'nagercoil',
  'hosur', 'theni', 'sivakasi', 'virudhunagar', 'kattankulathur', 'cuddalore', 'kumbakonam', 'pollachi',
  'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubballi', 'hubli', 'belagavi',
  'belgaum', 'udupi', 'shivamogga', 'shimoga', 'davanagere', 'ballari', 'bellary', 'gulbarga',
  'kalaburagi', 'tumkur', 'tumakuru', 'dharwad', 'bidar', 'hassan'
];

function isAllowedOfflineLocation(locationStr, name, desc) {
  const combined = `${locationStr || ''} ${name || ''} ${desc || ''}`.toLowerCase();
  return ALLOWED_STATES_CITIES.some(t => new RegExp(`\\b${t}\\b`, 'i').test(combined));
}

function hasPrize(prizeStr) {
  if (!prizeStr) return false;
  const p = prizeStr.toLowerCase().trim();
  if (p === '' || p === 'none' || p === 'no' || p === 'false' || p === '0' || p === 'nil') return false;
  return true;
}

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
      
      // Parse Mode
      const modeMatch = description.match(/Mode:\s*(.+)/i);
      const mode = modeMatch ? modeMatch[1].toLowerCase().trim() : '';
      
      // Parse Location
      const locationMatch = description.match(/Location:\s*(.+)/i);
      let location = locationMatch ? locationMatch[1].trim() : (item.location || '');
      
      // Parse Prize
      const prizeMatch = description.match(/Prize:\s*(.+)/i);
      const prize = prizeMatch ? prizeMatch[1].trim() : '';

      const isOnline = mode === 'online' || mode === 'virtual' || (!location || location.toLowerCase() === 'online');
      const isBoth = mode === 'both' || mode === 'hybrid';
      const isOffline = !isOnline && !isBoth;

      let keep = false;
      if (isOnline) {
        keep = hasPrize(prize);
      } else if (isOffline) {
        keep = isAllowedOfflineLocation(location, summary, description);
      } else if (isBoth) {
        keep = hasPrize(prize) || isAllowedOfflineLocation(location, summary, description);
      } else {
        keep = hasPrize(prize) || isAllowedOfflineLocation(location, summary, description);
      }

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
