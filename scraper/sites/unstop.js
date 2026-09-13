const { chromium } = require('playwright');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Unstop using Playwright and LLM
 */
async function scrapeUnstop() {
  console.log('Scraping Unstop...');
  const hackathons = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0' });
    
    // URL for hackathons on Unstop
    await page.goto('https://unstop.com/hackathons', { waitUntil: 'domcontentloaded' });
    
    // Wait for the listings to load
    await page.waitForSelector('.listing', { timeout: 10000 }).catch(() => {});
    
    const listingsHtml = await page.$eval('.listing', el => el.innerHTML).catch(() => null);
    
    if (listingsHtml) {
      const cleanText = stripHtmlForLlm(listingsHtml);
      const extracted = await extractHackathons(cleanText, 'https://unstop.com/hackathons');
      
      for (let h of extracted) {
        h.source = 'unstop';
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
    }
  } catch (error) {
    console.error('Unstop Scrape Error:', error.message);
  } finally {
    if (browser) await browser.close();
  }
  return hackathons;
}

module.exports = { scrapeUnstop };
