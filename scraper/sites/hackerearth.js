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
    
    let hasNext = true;
    let pageNum = 1;
    
    while (hasNext && pageNum <= 5) { // Cap at 5 pages for HackerEarth
      console.log(`Fetching HackerEarth page ${pageNum}...`);
      await page.waitForTimeout(5000); // Wait for challenges to render
      
      const listingsHtml = await page.evaluate(() => {
        const container = document.querySelector('.challenge-list') || document.querySelector('.challenges-container') || document.querySelector('.challenges-list');
        return container ? container.innerHTML : null;
      });
      
      if (listingsHtml) {
        const cleanText = stripHtmlForLlm(listingsHtml);
        const extracted = await extractHackathons(cleanText, 'https://www.hackerearth.com/challenges/hackathon/');
        
        for (let h of extracted) {
          h.source = 'hackerearth';
          h.isKeralaRelevant = checkKeralaRelevance(h);
          hackathons.push(h);
        }
      }
      
      // Try to go to next page
      const nextBtn = await page.$('.pagination .next, .pagination-next');
      if (nextBtn) {
        const isDisabled = await page.evaluate(el => el.classList.contains('disabled'), nextBtn);
        if (isDisabled) {
          hasNext = false;
        } else {
          await nextBtn.click();
          pageNum++;
        }
      } else {
        hasNext = false; // No pagination found
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
