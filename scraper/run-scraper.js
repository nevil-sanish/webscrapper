const { classifyAttendance, shouldKeepHackathon, keralaPriority } = require('./utils/eventPolicy');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { addEventToCalendar, isCalendarConfigured, maintainCalendar, formatDay } = require('./utils/calendar');
const { localDay } = require('./utils/calendarPolicy');
const { sendDeadlineEmail } = require('./utils/deadlineEmail');

// Anything that could have cost a hackathon is collected here and fails the
// run at the end, after everything that did work has been synced. A run that
// looks green must mean every source was read in full.
const problems = [];
const sourceStats = [];

// One source failing must not take the others down with it.
async function collect(name, scrape, { expectResults = true } = {}) {
  try {
    const events = await scrape();
    const stats = events.stats;
    if (stats) sourceStats.push(stats);
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

// One line per listing, so a run can be checked against the platform by hand:
// what each source said it had, what was read, and what happened to each one.
function writeScrapeReport(events) {
  const day = value => formatDay(value instanceof Date ? localDay(value) : String(value || '').slice(0, 10));
  const cell = value => String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  const lines = [`# Scrape report - ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`, ''];
  for (const stats of sourceStats) {
    lines.push(`- **${stats.source}**: platform reports ${stats.reported ?? '?'} open listings, ${stats.listed} read, ` +
      `${(stats.skippedItems || []).length} skipped, ${stats.failedPages || 0} listing page(s) and ${stats.failedDetails || 0} event page(s) failed`);
  }
  lines.push('', '| Source | Hackathon | Deadline | Result | Why | Link |', '|---|---|---|---|---|---|');
  for (const h of events) {
    const kept = shouldKeepHackathon(h);
    lines.push(`| ${h.source} | ${cell(h.name)} | ${day(h.registrationDeadline || h.startDate)} | ${kept ? 'IN CALENDAR' : 'left out'} | ` +
      `${kept ? '' : (h.mode === 'online' ? `online with registration fee ${cell(h.fee)}` : `${h.mode}, venue "${cell(h.location).slice(0, 60)}" is not in Kerala/Tamil Nadu/Karnataka`)} | ${h.sourceUrl} |`);
  }
  for (const stats of sourceStats) {
    for (const item of stats.skippedItems || []) {
      lines.push(`| ${stats.source} | ${cell(item.name)} | | skipped | ${item.reason} | ${item.url} |`);
    }
  }
  fs.writeFileSync(path.join(__dirname, 'scrapeReport.md'), lines.join('\n') + '\n');
  console.log('Per-listing report: scraper/scrapeReport.md');
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
    // Devpost (sites/devpost.js) and web search discovery (search/discovery.js)
    // are switched off at the owner's request: only Devfolio and Unstop run.
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
    writeScrapeReport(uniqueHackathons.map(h => classifyAttendance(h)));

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
