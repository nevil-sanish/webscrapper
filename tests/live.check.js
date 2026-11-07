// Live check against every real endpoint the scraper uses. Read-only: it lists
// Calendar entries, reads the sheet, scrapes each platform and verifies the SMTP
// login, but never adds, changes or deletes anything and sends no email.
// Run with `npm run test:live` (needs network and the values in .env).
require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeDevfolio } = require('../scraper/sites/devfolio');
const { scrapeUnstop } = require('../scraper/sites/unstop');
const { scrapeDevpost } = require('../scraper/sites/devpost');
const { scrapeHackIndia } = require('../scraper/sites/hackindia');
const { scrapeSheet } = require('../scraper/sites/sheet');
const { isCalendarConfigured, getCalendarClient } = require('../scraper/utils/calendar');

function checkEvents(events, { expectResults }) {
  assert.ok(Array.isArray(events), 'scraper must return an array');
  if (events.stats) {
    assert.equal(events.stats.complete, true,
      `scan incomplete: ${events.stats.failedPages || 0} listing page(s), ${events.stats.failedDetails || 0} event page(s) failed`);
  }
  if (expectResults) assert.ok(events.length > 0, 'returned no hackathons');
  for (const e of events) {
    assert.ok(e.name && String(e.name).trim(), `event without a name: ${JSON.stringify(e).slice(0, 120)}`);
    assert.match(String(e.sourceUrl || ''), /^https?:\/\//, `"${e.name}" has no valid link`);
    if (e.registrationDeadline) {
      assert.ok(!isNaN(new Date(e.registrationDeadline).getTime()), `"${e.name}" has an unreadable deadline`);
    }
  }
  return events.length;
}

const sources = [
  ['Devfolio', scrapeDevfolio, true],
  ['Unstop', scrapeUnstop, true],
  ['Devpost', scrapeDevpost, true],
  // These two can legitimately have nothing open.
  ['HackIndia', scrapeHackIndia, false],
  ['Google Sheet', scrapeSheet, false]
];
for (const [name, scrape, expectResults] of sources) {
  test(`${name} returns valid hackathons`, async () => {
    const count = checkEvents(await scrape(), { expectResults });
    console.log(`${name}: ${count} hackathon(s)`);
  });
}

test('Google Calendar credentials can read the calendar', { skip: !isCalendarConfigured() && 'Calendar not configured' }, async () => {
  const res = await getCalendarClient().events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary', maxResults: 1, timeMin: new Date().toISOString()
  });
  assert.ok(Array.isArray(res.data.items), 'Calendar listing has no items array');
});

test('SMTP login works', { skip: !process.env.SMTP_HOST && 'SMTP not configured' }, async () => {
  const transport = require('nodemailer').createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  assert.equal(await transport.verify(), true);
});
