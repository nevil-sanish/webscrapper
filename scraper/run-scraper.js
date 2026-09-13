require('dotenv').config();
const mongoose = require('mongoose');

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeDevpost } = require('./sites/devpost');
const { scrapeUnstop } = require('./sites/unstop');
const { scrapeHackerEarth } = require('./sites/hackerearth');
const { discoverViaSearch } = require('./search/googleSearch');

// Utils
const { deduplicateAndUpsert } = require('./utils/dedup');
const Hackathon = require('../server/models/Hackathon');
const Meta = require('../server/models/Meta');
const connectDB = require('../server/config/db');
const { sendEmailReport } = require('../email/sendReport');

async function run() {
  console.log('Starting Hackathon Aggregator Run...');
  
  try {
    await connectDB();
  } catch (err) {
    console.error('Failed to initialize run', err);
    process.exit(1);
  }

  let allNewHackathons = [];

  // Scrape Devfolio
  const devfolioData = await scrapeDevfolio();
  allNewHackathons = allNewHackathons.concat(devfolioData);

  // Scrape Devpost
  const devpostData = await scrapeDevpost();
  allNewHackathons = allNewHackathons.concat(devpostData);

  // Scrape Unstop
  const unstopData = await scrapeUnstop();
  allNewHackathons = allNewHackathons.concat(unstopData);

  // Scrape HackerEarth
  const heData = await scrapeHackerEarth();
  allNewHackathons = allNewHackathons.concat(heData);

  // Google Search Discovery (run one batch per run to save quota)
  const searchData = await discoverViaSearch();
  allNewHackathons = allNewHackathons.concat(searchData);

  console.log(`\nTotal scraped/extracted: ${allNewHackathons.length}`);
  
  if (allNewHackathons.length > 0) {
    // Deduplicate and upsert to MongoDB
    console.log('Deduplicating and saving to database...');
    const { inserted, updated } = await deduplicateAndUpsert(allNewHackathons, Hackathon);
    
    console.log(`Inserted ${inserted.length} new hackathons.`);
    console.log(`Updated ${updated.length} existing hackathons.`);
    
    // Send email report with only the newly inserted ones
    await sendEmailReport(inserted);
  } else {
    console.log('No hackathons found during this run.');
  }

  // Record last run timestamp
  await Meta.findOneAndUpdate(
    { key: 'lastRunTimestamp' },
    { value: new Date().toISOString() },
    { upsert: true }
  );

  console.log('Run complete. Closing database connection.');
  await mongoose.disconnect();
}

run().catch(console.error);
