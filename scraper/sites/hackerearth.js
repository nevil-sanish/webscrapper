const { chromium } = require('playwright');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape HackerEarth using Playwright and LLM
 */
async function scrapeHackerEarth() {
  console.log('Scraping HackerEarth...');
  const hackathons = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0' });
    
    await page.goto('https://www.hackerearth.com/challenges/hackathon/', { waitUntil: 'domcontentloaded' });
    
    // Wait for HackerEarth to render the list
    await page.waitForTimeout(5000);
    
    const listingsHtml = await page.evaluate(() => document.body.innerHTML);
    
    if (listingsHtml) {
      const cleanText = stripHtmlForLlm(listingsHtml);
      const extracted = await extractHackathons(cleanText, 'https://www.hackerearth.com/challenges/hackathon/');
      
      for (let h of extracted) {
        h.source = 'hackerearth';
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
    }
  } catch (error) {
    console.error('HackerEarth Scrape Error:', error.message);
  } finally {
    if (browser) await browser.close();
  }
  return hackathons;
}

module.exports = { scrapeHackerEarth };
