require('dotenv').config();

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');
const { scrapeHackerEarth } = require('./sites/hackerearth');
const { discoverViaSearch } = require('./search/serpApiSearch');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { sendEmailReport } = require('../email/sendReport');
const { addEventToCalendar } = require('./utils/calendar');

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

    // Add unique hackathons to Google Calendar (skips duplicates in Calendar)
    const newlyAdded = [];
    for (let h of uniqueHackathons) {
      const added = await addEventToCalendar(h);
      if (added) {
        newlyAdded.push(h);
      }
    }

    console.log(`Successfully added ${newlyAdded.length} new hackathons to Google Calendar.`);

    // Send email report with the newly added hackathons
    if (newlyAdded.length > 0) {
      await sendEmailReport(newlyAdded);
    } else {
      console.log('All discovered hackathons already exist in Google Calendar. No new email sent.');
    }
  } else {
    console.log('No hackathons found during this run.');
  }

  console.log('Hack Scrapper run complete.');
}

run().catch(console.error);
