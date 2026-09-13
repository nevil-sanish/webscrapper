require('dotenv').config();

// Scrapers
const { scrapeDevfolio } = require('./sites/devfolio');
const { scrapeUnstop } = require('./sites/unstop');
const { discoverViaSearch } = require('./search/serpApiSearch');

// Utils
const { deduplicateHackathons } = require('./utils/dedup');
const { addEventToCalendar, isCalendarConfigured } = require('./utils/calendar');

async function run() {
  console.log('Starting Hack Scrapper Run...');

  let allNewHackathons = [];

  // 1. Scrape Devfolio (https://devfolio.co/hackathons)
  const devfolioData = await scrapeDevfolio();
  allNewHackathons = allNewHackathons.concat(devfolioData);

  // 2. Scrape Unstop (https://unstop.com/hackathons?oppstatus=open&usertype=students)
  const unstopData = await scrapeUnstop();
  allNewHackathons = allNewHackathons.concat(unstopData);

  // 3. Google Search Discovery (top 5 websites per query)
  const searchData = await discoverViaSearch();
  allNewHackathons = allNewHackathons.concat(searchData);

  console.log(`\nTotal scraped/extracted: ${allNewHackathons.length}`);
  
  if (allNewHackathons.length > 0) {
    // In-memory deduplication across all sources
    console.log('Deduplicating discovered hackathons...');
    const uniqueHackathons = deduplicateHackathons(allNewHackathons);
    console.log(`Found ${uniqueHackathons.length} unique hackathons before filtering.`);

    // Filtering Logic
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

    function isAllowedOfflineLocation(h) {
      const combined = `${h.location || ''} ${h.name || ''} ${h.description || ''}`.toLowerCase();
      return ALLOWED_STATES_CITIES.some(t => new RegExp(`\\b${t}\\b`, 'i').test(combined));
    }

    function hasPrize(h) {
      if (!h.prize) return false;
      const p = h.prize.toString().toLowerCase().trim();
      if (p === '' || p === 'none' || p === 'no' || p === 'false' || p === '0' || p === 'nil') return false;
      return true;
    }

    const filteredHackathons = uniqueHackathons.filter(h => {
      const mode = (h.mode || '').toLowerCase();
      const isOnline = mode === 'online' || mode === 'virtual' || (!h.location || h.location.toLowerCase() === 'online');
      const isBoth = mode === 'both' || mode === 'hybrid';
      const isOffline = !isOnline && !isBoth;

      let keep = false;
      if (isOnline) {
        keep = hasPrize(h);
      } else if (isOffline) {
        keep = isAllowedOfflineLocation(h);
      } else if (isBoth) {
        keep = hasPrize(h) || isAllowedOfflineLocation(h);
      }
      return keep;
    });

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
