const axios = require('axios');
const { chromium } = require('playwright');
const { keralaKeywords } = require('./keywordList');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SERP_API_KEY = process.env.SERP_API_KEY;
const stateFile = path.join(__dirname, 'searchState.json');

/**
 * Searches Google via SerpApi and scrapes detail pages for hackathons
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

  // Filter out irrelevant domains (social media, aggregators without details, etc.)
  const filteredUrls = Array.from(allUrls).filter(u => {
    return !u.includes('facebook.com') && 
           !u.includes('twitter.com') && 
           !u.includes('x.com') && 
           !u.includes('youtube.com') &&
           !u.includes('instagram.com') &&
           !u.includes('linkedin.com/posts');
  }).slice(0, 10); // Take top 10 relevant URLs per run

  console.log(`Discovered ${allUrls.size} URLs, inspecting top ${filteredUrls.length} relevant URLs...`);
  const hackathons = [];

  // Scrape discovered URLs
  if (filteredUrls.length > 0) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      for (let url of filteredUrls) {
        try {
          const page = await browser.newPage();
          await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

          const html = await page.content();
          const cleanText = stripHtmlForLlm(html);

          if (cleanText && cleanText.length > 50) {
            const extracted = await extractHackathons(cleanText, url);
            for (let h of extracted) {
              h.source = 'serpapi-search';
              h.isKeralaRelevant = checkKeralaRelevance(h);
              hackathons.push(h);
            }
          }
          await page.close();
          await new Promise(r => setTimeout(r, 1000));
        } catch (pageError) {
          console.error(`Error scraping search result URL ${url}:`, pageError.message);
        }
      }
    } catch (browserError) {
      console.error('Playwright launch error in SerpApi discovery:', browserError.message);
    } finally {
      if (browser) await browser.close();
    }
  }

  return hackathons;
}

module.exports = { discoverViaSearch };
