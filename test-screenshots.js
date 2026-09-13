const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  console.log('Testing devpost...');
  await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0' });
  await page.goto('https://devpost.com/hackathons', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/home/nevilsanish/.gemini/antigravity-ide/brain/ddc0c6a9-f3ac-487d-a4ac-ff247bfd5dbe/scratch/devpost.png' });
  console.log('Saved devpost.png');
  
  console.log('Testing unstop...');
  await page.goto('https://unstop.com/hackathons', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: '/home/nevilsanish/.gemini/antigravity-ide/brain/ddc0c6a9-f3ac-487d-a4ac-ff247bfd5dbe/scratch/unstop.png' });
  console.log('Saved unstop.png');

  await browser.close();
})();
