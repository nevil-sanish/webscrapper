require('dotenv').config();

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');
const { scrapeHackerEarth } = require('./sites/hackerearth');
const { discoverViaSearch } = require('./search/serpApiSearch');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { sendEmailReport } = require('../email/sendReport');
const { addEventToCalendar, isCalendarConfigured } = require('./utils/calendar');

async function run() {
  console.log('Starting Hack Scrapper Run...');

  let allNewHackathons = [];

  // 1. Scrape Devfolio
  const devfolioData = await scrapeDevfolio();
  allNewHackathons = allNewHackathons.concat(devfolioData);

  // 2. Scrape Unstop
  const unstopData = await scrapeUnstop();
  allNewHackathons = allNewHackathons.concat(unstopData);

  // 3. Scrape HackerEarth
  const heData = await scrapeHackerEarth();
  allNewHackathons = allNewHackathons.concat(heData);

  // 4. Google Search Discovery (run one batch per run to save quota)
  const searchData = await discoverViaSearch();
  allNewHackathons = allNewHackathons.concat(searchData);

  console.log(`\nTotal scraped/extracted: ${allNewHackathons.length}`);
  
  if (allNewHackathons.length > 0) {
    // In-memory deduplication across all sources
    console.log('Deduplicating discovered hackathons...');
    const uniqueHackathons = deduplicateHackathons(allNewHackathons);
    console.log(`Found ${uniqueHackathons.length} unique hackathons.`);

    if (isCalendarConfigured()) {
      console.log('Syncing hackathons with Google Calendar...');
      const newlyAdded = [];
      for (let h of uniqueHackathons) {
        const added = await addEventToCalendar(h);
        if (added) {
          newlyAdded.push(h);
        }
      }

      console.log(`Successfully added ${newlyAdded.length} new hackathons to Google Calendar.`);

      if (newlyAdded.length > 0) {
        await sendEmailReport(newlyAdded);
      } else {
        console.log('All discovered hackathons already exist in Google Calendar. No new email sent.');
      }
    } else {
      console.warn('\n⚠️  GOOGLE CALENDAR IS NOT CONFIGURED');
      console.warn('GOOGLE_CALENDAR_REFRESH_TOKEN is empty in your .env file.');
      console.warn('Run `node scripts/auth-calendar.js` to authorize your Google Calendar.\n');
      // Still send email with all discovered unique hackathons
      await sendEmailReport(uniqueHackathons);
    }
  } else {
    console.log('No hackathons found during this run.');
  }

  console.log('Hack Scrapper run complete.');
}

run().catch(console.error);
