const { chromium } = require('playwright');
const { stripHtmlForLlm } = require('../utils/htmlStrip');
const { extractHackathons } = require('../llm/extract');
const { checkKeralaRelevance } = require('../utils/normalize');

/**
 * Scrape Devpost using Playwright and LLM
 */
async function scrapeDevpost() {
  console.log('Scraping Devpost...');
  const hackathons = [];
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    // Use a custom user agent
    await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' });
    
    await page.goto('https://devpost.com/hackathons', { waitUntil: 'domcontentloaded' });
    
    // Wait for the hackathon listings to render
    await page.waitForSelector('.hackathon-tile', { timeout: 10000 }).catch(() => {});
    
    // Extract the HTML of the main container to avoid sending the whole page
    const listingsHtml = await page.$eval('.hackathon-results', el => el.innerHTML).catch(() => null);
    
    if (listingsHtml) {
      const cleanText = stripHtmlForLlm(listingsHtml);
      const extracted = await extractHackathons(cleanText, 'https://devpost.com/hackathons');
      
      for (let h of extracted) {
        h.source = 'devpost';
        h.isKeralaRelevant = checkKeralaRelevance(h);
        hackathons.push(h);
      }
    }
  } catch (error) {
    console.error('Devpost Scrape Error:', error.message);
  } finally {
    if (browser) await browser.close();
  }
  return hackathons;
}

module.exports = { scrapeDevpost };
