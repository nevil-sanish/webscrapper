const { classifyAttendance, shouldKeepHackathon, keralaPriority } = require('./utils/eventPolicy');
require('dotenv').config();

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');
const { scrapeDevpost } = require('./sites/devpost');
const { discoverViaSearch } = require('./search/discovery');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { addEventToCalendar, isCalendarConfigured, maintainCalendar } = require('./utils/calendar');
const { sendDeadlineEmail } = require('./utils/deadlineEmail');

// Anything that could have cost a hackathon is collected here and fails the
// run at the end, after everything that did work has been synced. A run that
// looks green must mean every source was read in full.
const problems = [];

// One source failing must not take the others down with it.
async function collect(name, scrape, { expectResults = true } = {}) {
  try {
    const events = await scrape();
    const stats = events.stats;
    if (stats && !stats.complete) {
      problems.push(`${name}: scan incomplete (${stats.note || `${stats.failedPages || 0} listing page(s), ${stats.failedDetails || 0} event page(s) failed`})`);
    } else if (expectResults && events.length === 0) {
      problems.push(`${name}: returned no hackathons`);
    }
    return events;
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
    console.error(`${name} failed:`, error.message);
    return [];
  }
}

async function run() {
  console.log('Starting Hack Scrapper Run...');
  // Maintenance is the first Calendar call, so it also proves the credentials
  // still work before a whole scrape is spent on entries that cannot be saved.
  let calendarReady = isCalendarConfigured();
  if (calendarReady) {
    try {
      await maintainCalendar();
    } catch (error) {
      if (/invalid_grant|invalid_client|unauthorized_client/.test(error.message)) {
        calendarReady = false;
        problems.push('Google Calendar: authorization was rejected (' + error.message + '). Run `npm run auth:calendar`, ' +
          'then update the GOOGLE_CALENDAR_REFRESH_TOKEN secret on GitHub. Nothing was synced.');
      } else {
        problems.push(`Calendar maintenance: ${error.message}`);
      }
    }
  }

  const allNewHackathons = [
    // 1. Scrape Devfolio (https://devfolio.co/hackathons)
    ...await collect('Devfolio', scrapeDevfolio),
    // 2. Scrape Unstop (https://unstop.com/hackathons?oppstatus=open)
    ...await collect('Unstop', scrapeUnstop),
    // 3. Scan every Devpost public open/upcoming listing page.
    ...await collect('Devpost', scrapeDevpost),
    // 4. Google Search Discovery (Kerala-first, up to 10 results per query)
    ...await collect('Web discovery', () => discoverViaSearch({ platformsCovered: true }), { expectResults: false })
  ];

  console.log(`\nTotal scraped/extracted: ${allNewHackathons.length}`);
  
  if (allNewHackathons.length > 0) {
    // In-memory deduplication across all sources
    console.log('Deduplicating discovered hackathons...');
    const uniqueHackathons = deduplicateHackathons(allNewHackathons);
    console.log(`Found ${uniqueHackathons.length} unique hackathons before filtering.`);

    const filteredHackathons = uniqueHackathons
      .map(h => classifyAttendance(h))
      .filter(shouldKeepHackathon)
      .sort((a, b) => keralaPriority(b) - keralaPriority(a));

    console.log(`Kept ${filteredHackathons.length} hackathons after filtering rules.`);

    if (calendarReady) {
      console.log('Syncing hackathons with Google Calendar...');
      const newlyAdded = [];
      let failed = 0;
      for (let h of filteredHackathons) {
        try {
          const added = await addEventToCalendar(h);
          if (added) {
            newlyAdded.push(h);
          }
        } catch (error) {
          failed++;
          console.error(`Calendar sync failed for "${h.name}":`, error.response?.data?.error?.message || error.message);
        }
      }

      console.log(`Successfully added/updated ${newlyAdded.length} hackathons in Google Calendar.`);
      if (failed) problems.push(`Google Calendar: ${failed} hackathon(s) could not be saved`);
    } else if (!isCalendarConfigured()) {
      console.warn('\n⚠️  GOOGLE CALENDAR IS NOT CONFIGURED');
      console.warn('GOOGLE_CALENDAR_REFRESH_TOKEN is empty in your .env file.');
      console.warn('Run `node scripts/auth-calendar.js` to authorize your Google Calendar.\n');
    }
  } else {
    console.log('No hackathons found during this run.');
  }

  if (calendarReady) {
    try {
      await sendDeadlineEmail();
    } catch (error) {
      problems.push(`Deadline email: ${error.message}`);
    }
  }

  if (problems.length) {
    console.error(`\nRUN INCOMPLETE - hackathons may be missing from the calendar:\n${problems.map(p => `  - ${p}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('Hack Scrapper run complete: every source was read in full.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
