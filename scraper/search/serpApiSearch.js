const axios = require('axios');
const { chromium } = require('playwright');
const { keralaKeywords } = require('./keywordList');
const { checkKeralaRelevance } = require('../utils/normalize');
const { parseExactHackathonPage } = require('../utils/pageParser');

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SERP_API_KEY = process.env.SERP_API_KEY;
const stateFile = path.join(__dirname, 'searchState.json');

/**
 * Searches Google via SerpApi, visits each discovered hackathon exact page,
 * and parses name, place, mode, and registration end date using pure JS.
 * Zero LLM API calls.
 */
async function discoverViaSearch() {
  console.log('Running SerpApi Search Discovery...');
  const allUrls = new Set();

  if (!SERP_API_KEY) {
    console.warn('Skipping SerpApi Search: Missing SERP_API_KEY in .env.');
    return [];
  }

  // Read last used keyword index from local state file
  let currentIndex = 0;
  try {
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      currentIndex = data.currentIndex || 0;
    }
  } catch (e) {
    currentIndex = 0;
  }

  const keywordsToUse = [];
  const numKeywords = 5;
  for (let i = 0; i < numKeywords; i++) {
    keywordsToUse.push(keralaKeywords[(currentIndex + i) % keralaKeywords.length]);
  }

  // Save next index to local state file
  try {
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ currentIndex: (currentIndex + numKeywords) % keralaKeywords.length }, null, 2),
      'utf8'
    );
  } catch (e) {}

  for (let query of keywordsToUse) {
    console.log(`SerpApi Google Query: "${query}"`);
    try {
      const res = await axios.get('https://serpapi.com/search.json', {
        params: {
          engine: 'google',
          q: query,
          api_key: SERP_API_KEY,
          num: 5,
          gl: 'in',
          hl: 'en'
        },
        family: 4,
        timeout: 30000
      });

      const organic = res.data?.organic_results || [];
      for (let item of organic) {
        if (item.link && item.link.startsWith('http')) {
          allUrls.add(item.link);
        }
      }
    } catch (error) {
      console.error(`SerpApi error for query "${query}":`, error.response?.data?.error || error.message);
    }
  }

  // Filter out social media and non-event aggregation lists
  const filteredUrls = Array.from(allUrls).filter(u => {
    return !u.includes('facebook.com') && 
           !u.includes('twitter.com') && 
           !u.includes('x.com') && 
           !u.includes('youtube.com') &&
           !u.includes('instagram.com') &&
           !u.includes('linkedin.com') &&
           !u.includes('reddit.com') &&
           !u.includes('wikipedia.org');
  }).slice(0, 10); // Inspect top 10 candidate URLs per run

  console.log(`Discovered ${allUrls.size} URLs, inspecting ${filteredUrls.length} exact event pages...`);
  const hackathons = [];

  let browser = null;

  for (let url of filteredUrls) {
    try {
      let html = null;

      // 1. First attempt fast HTTP fetch
      try {
        const pageRes = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          timeout: 8000
        });
        if (pageRes.data && typeof pageRes.data === 'string' && pageRes.data.length > 500) {
          html = pageRes.data;
        }
      } catch (httpErr) {
        // Fallback to browser below
      }

      // 2. Browser fallback for JavaScript heavy SPAs
      if (!html || html.length < 1000) {
        if (!browser) {
          browser = await chromium.launch({ headless: true });
        }
        const page = await browser.newPage();
        await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);
        html = await page.content();
        await page.close();
      }

      if (html) {
        const parsed = parseExactHackathonPage(html, url);
        if (parsed && parsed.name && parsed.registrationDeadline) {
          const h = {
            name: parsed.name,
            startDate: parsed.registrationDeadline,
            endDate: parsed.registrationDeadline,
            registrationDeadline: parsed.registrationDeadline,
            location: parsed.place,
            mode: parsed.mode,
            fee: parsed.fee || 'Free',
            organizer: null,
            prize: null,
            eligibility: null,
            tags: [],
            description: parsed.description,
            sourceUrl: url,
            source: 'search-exact-page'
          };
          h.isKeralaRelevant = checkKeralaRelevance(h);
          hackathons.push(h);
          console.log(`Parsed exact hackathon from search: "${h.name}" (mode: ${h.mode}, place: ${h.location}, regDeadline: ${h.startDate})`);
        }
      }
    } catch (pageError) {
      console.error(`Error parsing exact search page ${url}:`, pageError.message);
    }
  }

  if (browser) {
    await browser.close();
  }

  return hackathons;
}

module.exports = { discoverViaSearch };
