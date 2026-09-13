const axios = require('axios');
const { chromium } = require('playwright');
const { keralaKeywords } = require('./keywordList');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

require('dotenv').config();

const API_KEY = process.env.GOOGLE_SEARCH_CLIENT_ID; // Depending on how you configure it, this could be API key
const CX = process.env.GOOGLE_SEARCH_CLIENT_SECRET; // This would normally be the Search Engine ID

/**
 * Searches Google and scrapes results for hackathons
 */
async function discoverViaSearch() {
  console.log('Running Google Custom Search Discovery...');
  const allUrls = new Set();
  
  // To avoid hitting rate limits easily, we might only pick 1-2 keywords per run
  const randomKeywords = [
    keralaKeywords[Math.floor(Math.random() * keralaKeywords.length)]
  ];
  
  for (let query of randomKeywords) {
    try {
      // Check if credentials exist and don't look like OAuth Client IDs
      if (!API_KEY || !CX || API_KEY.includes('googleusercontent.com')) {
        console.warn('Skipping Google Search Discovery: Invalid or missing Custom Search API Key/CX (Found OAuth credentials instead).');
        return [];
      }

      const res = await axios.get('https://www.googleapis.com/customsearch/v1', {
        params: {
          key: API_KEY,
          cx: CX,
          q: query,
          num: 5 // Top 5 results
        }
      });
      
      const items = res.data.items || [];
      for (let item of items) {
        allUrls.add(item.link);
      }
    } catch (error) {
      console.error(`Google Search API Error for query "${query}":`, error.response?.data?.error?.message || error.message);
    }
  }

  const hackathons = [];
  
  // Scrape the discovered URLs
  if (allUrls.size > 0) {
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      for (let url of allUrls) {
        try {
          const page = await browser.newPage();
          await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0' });
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          
          const html = await page.content();
          const cleanText = stripHtmlForLlm(html);
          
          const extracted = await extractHackathons(cleanText, url);
          for (let h of extracted) {
            h.source = 'search';
            h.isKeralaRelevant = checkKeralaRelevance(h);
            hackathons.push(h);
          }
          await page.close();
        } catch (pageError) {
          console.error(`Error scraping search result URL ${url}:`, pageError.message);
        }
      }
    } catch (browserError) {
       console.error('Playwright launch error in search discovery:', browserError.message);
    } finally {
      if (browser) await browser.close();
    }
  }
  
  return hackathons;
}

module.exports = { discoverViaSearch };
