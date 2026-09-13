const { chromium } = require('playwright');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape HackerEarth challenges using Playwright and LLM
 */
async function scrapeHackerEarth() {
  console.log('Scraping HackerEarth...');
  const hackathons = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    
    const targetUrl = 'https://www.hackerearth.com/challenges/';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3500); // Allow challenges to render
    
    const html = await page.content();
    const cleanText = stripHtmlForLlm(html);
    
    if (cleanText) {
      const extracted = await extractHackathons(cleanText, targetUrl);
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
  
  console.log(`Extracted ${hackathons.length} hackathons from HackerEarth.`);
  return hackathons;
}

module.exports = { scrapeHackerEarth };
