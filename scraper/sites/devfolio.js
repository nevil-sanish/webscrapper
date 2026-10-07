const { classifyAttendance, keralaPriority, plainText } = require('../utils/eventPolicy');
const cheerio = require('cheerio');
const { parseDateToYMD, parseCountdownToDate } = require('../utils/pageParser');
const { localDay } = require('../utils/calendarPolicy');
const { getWithRetry, postWithRetry, sleep } = require('../utils/http');

/**
 * Scrapes Devfolio hackathons by discovering open hackathons and visiting
 * each hackathon's exact page (e.g. https://<subdomain>.devfolio.co) to extract:
 * 1. name
 * 2. place (location)
 * 3. mode (online, offline, both)
 * 4. registration end date (from countdown timer / reg_ends_at)
 */
function resolveRegistrationDeadline({ timerTimestamp, bodyText, now = new Date(), todayYMD, countdownParser = parseCountdownToDate } = {}) {
  const today = todayYMD || localDay(now);

  // The rendered countdown is the live source of truth. Devfolio's search
  // index can retain an old reg_ends_at value after organisers extend a
  // deadline.
  const text = String(bodyText || '');
  const timerTextMatch = text.match(/APPLICATIONS CLOSE IN\s*([0-9dhm:\s]+)/i) ||
    text.match(/(\d+\s*d(?:ays?)?\s*(?:\d+\s*h(?:ours?)?)?\s*(?:\d+\s*m(?:inutes?)?)?\s*left)/i);
  const liveCountdownDate = timerTextMatch ? countdownParser(timerTextMatch[1]) : null;
  if (liveCountdownDate && liveCountdownDate >= today) return liveCountdownDate;

  const indexedDate = timerTimestamp ? parseDateToYMD(timerTimestamp) : null;
  return indexedDate && indexedDate >= today ? indexedDate : null;
}

async function scrapeDevfolio({ retryDelayMs = 1000 } = {}) {
  console.log('Scraping Devfolio (https://devfolio.co/hackathons/open)...');
  const hackathons = [];
  const stats = { source: 'devfolio', listed: 0, failedPages: 0, failedDetails: 0, skipped: {}, complete: false };
  hackathons.stats = stats;
  const retry = { delayMs: retryDelayMs };

  try {
    const size = 30;
    let totalPages = null;
    const now = new Date();
    const todayYMD = localDay(now);
    const openHackathonsList = [];
    const seenSubdomains = new Set();

    // Step 1: Discover list of open hackathons from Devfolio. Every page the
    // reported total implies is requested; a page that keeps failing is
    // counted and the remaining pages are still read.
    for (let from = 0; from < (totalPages || 1) * size; from += size) {
      console.log(`Fetching Devfolio open hackathons list (from ${from})...`);
      let response;
      try {
        response = await postWithRetry('https://api.devfolio.co/api/search/hackathons', {
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
        }, retry);
      } catch (error) {
        stats.failedPages++;
        console.error(`Devfolio list page (from ${from}) failed: ${error.response?.status || error.code || error.message}`);
        continue;
      }

      const hits = response.data?.hits?.hits || [];
      const reportedTotal = Number(response.data?.hits?.total?.value);
      if (Number.isInteger(reportedTotal) && reportedTotal > 0) {
        totalPages = Math.max(totalPages || 0, Math.ceil(reportedTotal / size));
      }

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

      await sleep(200);
    }

    stats.listed = openHackathonsList.length;
    console.log(`Discovered ${openHackathonsList.length} open hackathons. Visiting exact pages...`);

    openHackathonsList.sort((a, b) => keralaPriority(b.initialHit) - keralaPriority(a.initialHit));

    // Step 2: Visit each hackathon's exact page to parse name, place, mode, and countdown registration end date
    for (let item of openHackathonsList) {
      const exactUrl = `https://${item.subdomain}.devfolio.co`;
      try {
        const pageRes = await getWithRetry(exactUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          family: 4,
          timeout: 10000
        }, { ...retry, attempts: 2 });

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

        let regEndDate = resolveRegistrationDeadline({ timerTimestamp, bodyText, now, todayYMD });

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
          if (timerTextMatch) daysLeftStr = timerTextMatch[1].trim();
        }

        // Filter: Must have a valid registration closing date that is today or in the future
        if (!regEndDate || regEndDate < todayYMD) {
          stats.skipped['no-open-registration-deadline'] = (stats.skipped['no-open-registration-deadline'] || 0) + 1;
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
          endDate: parseDateToYMD(nextData?.ends_at || item.initialHit?.ends_at || '') || regEndDate,
          registrationDeadline: regEndDate,
          eventConductedDate: parseDateToYMD(nextData?.starts_at || item.initialHit?.starts_at || ''),
          eventEndDate: parseDateToYMD(nextData?.ends_at || item.initialHit?.ends_at || ''),
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
        stats.failedDetails++;
        console.error(`Devfolio page ${exactUrl} failed (${err.response?.status || err.code || err.message}); using its listing data.`);
        const hit = item.initialHit;
        const appClosingDate = hit?.hackathon_setting?.reg_ends_at || hit?.reg_ends_at;
        const regEndDate = parseDateToYMD(appClosingDate);
        if (regEndDate && regEndDate >= todayYMD) {
          const loc = hit.location || [hit.city, hit.state].filter(Boolean).join(', ') || (hit.is_online ? 'Online' : 'In-person');
          let mode = hit.is_online === false ? 'offline' : (loc.toLowerCase() !== 'online' ? 'both' : 'online');
          let h = {
            name: hit.name,
            startDate: regEndDate,
            endDate: parseDateToYMD(hit.ends_at || '') || regEndDate,
            registrationDeadline: regEndDate,
            eventConductedDate: parseDateToYMD(hit.starts_at || ''),
            eventEndDate: parseDateToYMD(hit.ends_at || ''),
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
      await sleep(120);
    }
    // A page that fell back to its listing data still produced the event.
    stats.complete = Boolean(totalPages) && stats.failedPages === 0;
  } catch (error) {
    console.error('Devfolio Scrape Error:', error.message);
  }

  console.log(`Extracted ${hackathons.length} hackathons from ${stats.listed} Devfolio listings` +
    `${stats.complete ? '.' : ` - INCOMPLETE: ${stats.failedPages} listing page(s) failed.`}`);
  return hackathons;
}

module.exports = { scrapeDevfolio, resolveRegistrationDeadline };
