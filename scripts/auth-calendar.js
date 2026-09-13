require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const destroyer = require('server-destroy');

/**
 * To run this:
 * 1. Ensure GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET are in .env
 * 2. Add http://localhost:3000/oauth2callback as an Authorized Redirect URI in your Google Cloud Console for the OAuth client.
 * 3. Run `node scripts/auth-calendar.js`
 */

const CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET in .env");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const scopes = [
  'https://www.googleapis.com/auth/calendar.events'
];

async function authenticate() {
  return new Promise((resolve, reject) => {
    // Generate the url that will be used for authorization
    const authorizeUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force consent screen to ensure refresh token is returned
      scope: scopes,
    });

    // Start local server to accept the redirect
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url.indexOf('/oauth2callback') > -1) {
          const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
          res.end('Authentication successful! Please return to the console.');
          server.destroy();
          
          const code = qs.get('code');
          console.log(`\nAuthorization Code Received: ${code}\n`);
          
          const { tokens } = await oauth2Client.getToken(code);
          oauth2Client.credentials = tokens;
          resolve(tokens);
        }
      } catch (e) {
        reject(e);
      }
    }).listen(3000, () => {
      console.log(`\nPlease open the following URL in your browser to authenticate:\n`);
      console.log(authorizeUrl);
      console.log(`\nWaiting for authentication...`);
    });
    
    destroyer(server);
  });
}

authenticate().then((tokens) => {
  console.log('\n=======================================');
  console.log('SUCCESS! Add this to your .env file:');
  console.log('=======================================');
  console.log(`GOOGLE_CALENDAR_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log('=======================================\n');
}).catch(console.error);
