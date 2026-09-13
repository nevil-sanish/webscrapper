const axios = require('axios');
const cheerio = require('cheerio');
const { checkKeralaRelevance } = require('../utils/normalize');
const { parseExactHackathonPage, parseDateToYMD } = require('../utils/pageParser');

/**
 * Scrapes HackerEarth challenges using direct page parsing.
 * Completely deterministic without any LLM API calls.
 */
async function scrapeHackerEarth() {
  console.log('Scraping HackerEarth...');
  const hackathons = [];

  try {
    const targetUrl = 'https://www.hackerearth.com/challenges/hackathon/';
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (response.status === 200 && response.data) {
      const $ = cheerio.load(response.data);
      const links = new Set();
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (href.includes('/challenges/hackathon/') && !href.endsWith('/challenges/hackathon/')) {
          links.add(href.startsWith('http') ? href : `https://www.hackerearth.com${href}`);
        }
      });

      for (let link of links) {
        try {
          const detailRes = await axios.get(link, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 8000
          });
          const parsed = parseExactHackathonPage(detailRes.data, link);
          if (parsed && parsed.name && parsed.registrationDeadline) {
            const h = {
              name: parsed.name,
              startDate: parsed.registrationDeadline,
              endDate: parsed.registrationDeadline,
              registrationDeadline: parsed.registrationDeadline,
              location: parsed.place || 'Online',
              mode: parsed.mode || 'online',
              organizer: null,
              prize: null,
              eligibility: null,
              tags: [],
              description: parsed.description,
              sourceUrl: link,
              source: 'hackerearth'
            };
            h.isKeralaRelevant = checkKeralaRelevance(h);
            hackathons.push(h);
          }
        } catch (e) {
          // Skip individual failed challenge page
        }
      }
    } else {
      console.log(`HackerEarth returned status ${response.status} (bypassed).`);
    }
  } catch (error) {
    console.warn('HackerEarth Scrape Notice:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from HackerEarth.`);
  return hackathons;
}

module.exports = { scrapeHackerEarth };
