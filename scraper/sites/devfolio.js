const { classifyAttendance, keralaPriority, plainText } = require('../utils/eventPolicy');
const axios = require('axios');
const cheerio = require('cheerio');
const { parseDateToYMD, parseCountdownToDate } = require('../utils/pageParser');

/**
 * Scrapes Devfolio hackathons by discovering open hackathons and visiting
 * each hackathon's exact page (e.g. https://<subdomain>.devfolio.co) to extract:
 * 1. name
 * 2. place (location)
 * 3. mode (online, offline, both)
 * 4. registration end date (from countdown timer / reg_ends_at)
 */
async function scrapeDevfolio() {
  console.log('Scraping Devfolio (https://devfolio.co/hackathons/open)...');
  const hackathons = [];

  try {
    let from = 0;
    const size = 30;
    let hasMore = true;
    const now = new Date();
    const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const openHackathonsList = [];
    const seenSubdomains = new Set();

    // Step 1: Discover list of open hackathons from Devfolio
    while (hasMore) {
      console.log(`Fetching Devfolio open hackathons list (from ${from})...`);
      const response = await axios.post('https://api.devfolio.co/api/search/hackathons', {
        type: 'application_open',
        from: from,
        size: size
      }, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
        },
        family: 4,
        timeout: 10000
      });

      const hits = response.data?.hits?.hits || [];
      const total = response.data?.hits?.total?.value || 0;

      if (hits.length === 0) {
        hasMore = false;
        break;
      }

      const previousCount = seenSubdomains.size;
      for (let item of hits) {
        const hit = item._source;
        if (!hit || !hit.name) continue;
        const subdomain = hit.hackathon_setting?.subdomain || hit.subdomain || hit.slug;
        if (subdomain && !seenSubdomains.has(subdomain)) {
          seenSubdomains.add(subdomain);
          openHackathonsList.push({
            subdomain: subdomain,
            slug: hit.slug || subdomain,
            name: hit.name,
            initialHit: hit
          });
        }
      }

      if (seenSubdomains.size === previousCount) break;
      from += hits.length;
      if (hits.length < size || (total > 0 && from >= total)) {
        hasMore = false;
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log(`Discovered ${openHackathonsList.length} open hackathons. Visiting exact pages...`);

    openHackathonsList.sort((a, b) => keralaPriority(b.initialHit) - keralaPriority(a.initialHit));

    // Step 2: Visit each hackathon's exact page to parse name, place, mode, and countdown registration end date
    for (let item of openHackathonsList) {
      const exactUrl = `https://${item.subdomain}.devfolio.co`;
      try {
        const pageRes = await axios.get(exactUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          family: 4,
          timeout: 10000
        });

        const html = pageRes.data;
        const $ = cheerio.load(html);

        // Read embedded Next.js state on the exact page
        let nextData = null;
        try {
          const rawNext = $('#__NEXT_DATA__').html();
          if (rawNext) {
            nextData = JSON.parse(rawNext)?.props?.pageProps?.hackathon;
          }
        } catch (e) {}

        // 1. Name
        let name = nextData?.name ||
                   $('h1').first().text().trim() ||
                   $('meta[property="og:title"]').attr('content') ||
                   item.name;
        name = name.replace(/\s*\|\s*Devfolio.*/i, '').trim();

        // 2. Place
        let place = nextData?.location ||
                    [nextData?.city, nextData?.state, nextData?.country].filter(Boolean).join(', ') ||
                    item.initialHit?.location;
        const bodyText = plainText($('body').html());
        const happeningMatch = bodyText.match(/HAPPENING\s*\n+([^\n]+)/i);
        if (happeningMatch && !/online/i.test(happeningMatch[1])) {
          place = happeningMatch[1].trim();
        }
        if (!place) {
          place = (nextData?.is_online || item.initialHit?.is_online) ? 'Online' : 'In-person';
        }

        // 3. Mode
        let mode = 'online';
        const isOnlineSetting = nextData ? nextData.is_online : item.initialHit?.is_online;
        const isHybridSetting = nextData?.settings?.is_hybrid || false;
        const hasPhysicalPlace = place && place.toLowerCase() !== 'online' && !place.toLowerCase().includes('virtual');

        if (isHybridSetting) {
          mode = 'both';
        } else if (isOnlineSetting === false) {
          mode = 'offline';
        } else if (hasPhysicalPlace) {
          mode = isOnlineSetting ? 'both' : 'offline';
        }

        // 4. Registration End Date & Countdown Timer (Applications close in)
        const timerTimestamp = nextData?.settings?.reg_ends_at ||
                               nextData?.hackathon_setting?.reg_ends_at ||
                               nextData?.reg_ends_at ||
                               item.initialHit?.hackathon_setting?.reg_ends_at ||
                               item.initialHit?.reg_ends_at;

        let regEndDate = timerTimestamp ? parseDateToYMD(timerTimestamp) : null;

        // Days left string calculation
        let daysLeftStr = null;
        if (timerTimestamp) {
          const diffMs = new Date(timerTimestamp).getTime() - Date.now();
          if (diffMs > 0) {
            const d = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const h = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            daysLeftStr = `${d}d:${h}h:${m}m (${d} days left)`;
          }
        }

        // Fallback: search body text for countdown patterns if timestamp not found
        if (!regEndDate) {
          const timerTextMatch = bodyText.match(/APPLICATIONS CLOSE IN\s*([0-9dhm:\s]+)/i) ||
                                 bodyText.match(/(\d+\s*d(?:ays?)?\s*(?:\d+\s*h(?:ours?)?)?\s*left)/i);
          if (timerTextMatch) {
            regEndDate = parseCountdownToDate(timerTextMatch[1]);
            daysLeftStr = timerTextMatch[1].trim();
          }
        }

        // Filter: Must have a valid registration closing date that is today or in the future
        if (!regEndDate || regEndDate < todayYMD) {
          continue;
        }

        // 5. Fee
        let fee = 'Free';
        if (nextData?.settings?.paid) {
          fee = nextData?.settings?.fee_amount ? `₹${nextData.settings.fee_amount}` : 'Paid';
        } else {
          const feeMatch = bodyText.match(/(?:registration (?:cost|fee)[s]?|participation fee|entry fee)\s*[:\-–]?\s*([₹Rs\.]*\s*[\d,]+)/i);
          if (feeMatch) {
            fee = feeMatch[1].trim();
          }
        }

        const prizes = Array.isArray(nextData?.prizes || item.initialHit?.prizes) && (nextData?.prizes || item.initialHit?.prizes).length > 0
          ? (nextData?.prizes || item.initialHit?.prizes).map(p => p.name).slice(0, 3).join(', ')
          : null;

        let h = {
          name: name,
          startDate: regEndDate,
          endDate: nextData?.ends_at || item.initialHit?.ends_at || regEndDate,
          registrationDeadline: regEndDate,
          eventConductedDate: nextData?.starts_at || item.initialHit?.starts_at || null,
          location: place,
          mode: mode,
          fee: fee,
          daysLeft: daysLeftStr,
          organizer: nextData?.tagline || item.initialHit?.tagline || null,
          prize: prizes,
          eligibility: null,
          tags: Array.isArray(nextData?.themes || item.initialHit?.themes)
            ? (nextData?.themes || item.initialHit?.themes).map(t => t.theme?.name || t.name).filter(Boolean)
            : [],
          description: nextData?.desc ? nextData.desc.slice(0, 300) : (item.initialHit?.desc ? item.initialHit.desc.slice(0, 300) : null),
          sourceUrl: exactUrl,
          source: 'devfolio'
        };

        h = classifyAttendance(h, `${bodyText} ${nextData?.desc || item.initialHit?.desc || ''}`);
        hackathons.push(h);
      } catch (err) {
        // Fallback to initialHit if exact page fetch failed
        const hit = item.initialHit;
        const appClosingDate = hit?.hackathon_setting?.reg_ends_at || hit?.reg_ends_at;
        const regEndDate = parseDateToYMD(appClosingDate);
        if (regEndDate && regEndDate >= todayYMD) {
          const loc = hit.location || [hit.city, hit.state].filter(Boolean).join(', ') || (hit.is_online ? 'Online' : 'In-person');
          let mode = hit.is_online === false ? 'offline' : (loc.toLowerCase() !== 'online' ? 'both' : 'online');
          let h = {
            name: hit.name,
            startDate: regEndDate,
            endDate: hit.ends_at || regEndDate,
            registrationDeadline: regEndDate,
            location: loc,
            mode: mode,
            organizer: hit.tagline || null,
            prize: null,
            eligibility: null,
            tags: [],
            description: hit.desc ? hit.desc.slice(0, 300) : null,
            sourceUrl: exactUrl,
            source: 'devfolio'
          };
          h = classifyAttendance(h, hit.desc || '');
          hackathons.push(h);
        }
      }

      // Respectful delay between page requests
      await new Promise(r => setTimeout(r, 120));
    }
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from Devfolio exact pages.`);
  return hackathons;
}

module.exports = { scrapeDevfolio };
