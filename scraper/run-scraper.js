const { classifyAttendance, shouldKeepHackathon, keralaPriority } = require('./utils/eventPolicy');
require('dotenv').config();

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');
const { discoverViaSearch } = require('./search/discovery');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { addEventToCalendar, isCalendarConfigured, maintainCalendar } = require('./utils/calendar');

async function run() {
  console.log('Starting Hack Scrapper Run...');
  if (isCalendarConfigured()) await maintainCalendar();

  let allNewHackathons = [];

  // 1. Scrape Devfolio (https://devfolio.co/hackathons)
  const devfolioData = await scrapeDevfolio();
  allNewHackathons = allNewHackathons.concat(devfolioData);

  // 2. Scrape Unstop (https://unstop.com/hackathons?oppstatus=open)
  const unstopData = await scrapeUnstop();
  allNewHackathons = allNewHackathons.concat(unstopData);

  // 3. Google Search Discovery (Kerala-first, up to 10 results per query)
  const searchData = await discoverViaSearch({ platformsCovered: true });
  allNewHackathons = allNewHackathons.concat(searchData);

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

    if (isCalendarConfigured()) {
      console.log('Syncing hackathons with Google Calendar...');
      const newlyAdded = [];
      for (let h of filteredHackathons) {
        const added = await addEventToCalendar(h);
        if (added) {
          newlyAdded.push(h);
        }
      }

      console.log(`Successfully added/updated ${newlyAdded.length} hackathons in Google Calendar.`);
    } else {
      console.warn('\n⚠️  GOOGLE CALENDAR IS NOT CONFIGURED');
      console.warn('GOOGLE_CALENDAR_REFRESH_TOKEN is empty in your .env file.');
      console.warn('Run `node scripts/auth-calendar.js` to authorize your Google Calendar.\n');
    }
  } else {
    console.log('No hackathons found during this run.');
  }

  console.log('Hack Scrapper run complete.');
}

run().catch(console.error);
