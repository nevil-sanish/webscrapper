const { classifyAttendance, plainText } = require('./eventPolicy');
const cheerio = require('cheerio');

const MONTH_NAMES = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12'
};

/**
 * Normalizes date string into YYYY-MM-DD format
 * Supports:
 * - ISO formats: 2026-10-15T... -> 2026-10-15
 * - Textual formats: 15 Oct 2026, Oct 15, 2026, 15th October 2026
 * - Numeric formats: 15/10/2026, 2026/10/15
 */
function parseDateToYMD(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const clean = dateStr.trim();

  // 1. Direct ISO match: YYYY-MM-DD
  const isoMatch = clean.match(/\b(20\d{2})[-/](0[1-9]|1[0-2])[-/](0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Month Day Year: Oct 15, 2026 or October 15th 2026
  const mdyMatch = clean.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/i);
  if (mdyMatch) {
    const month = MONTH_NAMES[mdyMatch[1].toLowerCase()];
    if (month) {
      const day = String(parseInt(mdyMatch[2], 10)).padStart(2, '0');
      return `${mdyMatch[3]}-${month}-${day}`;
    }
  }

  // 3. Day Month Year: 15 Oct 2026 or 15th October 2026
  const dmyMatch = clean.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(20\d{2})\b/i);
  if (dmyMatch) {
    const month = MONTH_NAMES[dmyMatch[2].toLowerCase()];
    if (month) {
      const day = String(parseInt(dmyMatch[1], 10)).padStart(2, '0');
      return `${dmyMatch[3]}-${month}-${day}`;
    }
  }

  // 4. DD/MM/YYYY or DD-MM-YYYY
  const numDmyMatch = clean.match(/\b(0[1-9]|[12]\d|3[01])[-/.](0[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if (numDmyMatch) {
    return `${numDmyMatch[3]}-${numDmyMatch[2]}-${numDmyMatch[1]}`;
  }

  // 5. JavaScript Date fallback
  const d = new Date(clean);
  if (!isNaN(d.getTime()) && d.getFullYear() >= 2024 && d.getFullYear() <= 2030) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return null;
}

/**
 * Calculates deadline from countdown timer string:
 * - "1d:15h:59m"
 * - "11d 4h left"
 * - "5 days left"
 * - "closes in 3 days"
 */
function parseCountdownToDate(text) {
  if (!text || typeof text !== 'string') return null;

  // Format 1: 1d:15h:59m or 1d:15h
  const colonMatch = text.match(/(\d+)\s*d\s*:\s*(\d+)\s*h(?:\s*:\s*(\d+)\s*m)?/i);
  if (colonMatch) {
    const days = parseInt(colonMatch[1], 10);
    const hours = parseInt(colonMatch[2], 10) || 0;
    const minutes = parseInt(colonMatch[3], 10) || 0;
    const msToAdd = (days * 24 * 60 + hours * 60 + minutes) * 60 * 1000;
    const target = new Date(Date.now() + msToAdd);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Format 2: "11d 4h" or "11 days 4 hours" or "11d left" or "11 days left"
  const generalMatch = text.match(/(\d+)\s*d(?:ays?)?(?:\s*(\d+)\s*h(?:ours?)?)?/i);
  if (generalMatch) {
    const days = parseInt(generalMatch[1], 10);
    const hours = parseInt(generalMatch[2], 10) || 0;
    const msToAdd = (days * 24 + hours) * 60 * 60 * 1000;
    const target = new Date(Date.now() + msToAdd);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Format 3: "hours left" (within 24 hours) -> today or tomorrow
  const hoursOnlyMatch = text.match(/(\d+)\s*h(?:ours?)?\s*(?:left|remaining)?/i);
  if (hoursOnlyMatch) {
    const hours = parseInt(hoursOnlyMatch[1], 10);
    const target = new Date(Date.now() + hours * 60 * 60 * 1000);
    const y = target.getFullYear();
    const m = String(target.getMonth() + 1).padStart(2, '0');
    const d = String(target.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Extracts the 4 core fields from an exact hackathon HTML page:
 * 1. Name
 * 2. Place (Location)
 * 3. Mode (online, offline, both)
 * 4. Registration End Date (Deadline)
 * 
 * @param {string} html - Raw HTML of the exact hackathon page
 * @param {string} pageUrl - The URL of the exact hackathon page
 * @returns {Object|null} - { name, place, mode, registrationDeadline, description, sourceUrl }
 */
function parseExactHackathonPage(html, pageUrl, options = {}) {
  if (!html || typeof html !== 'string') return null;

  const $ = cheerio.load(html);

  // ----------------------------------------------------
  // 1. JSON-LD Extraction (schema.org)
  // ----------------------------------------------------
  let jsonLdEvent = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html());
      const checkObj = (obj) => {
        if (!obj || typeof obj !== 'object') return false;
        const type = String(obj['@type'] || '').toLowerCase();
        return type.includes('event') || type.includes('hackathon') || type.includes('competition');
      };

      if (Array.isArray(data)) {
        const found = data.find(checkObj);
        if (found) jsonLdEvent = found;
      } else if (checkObj(data)) {
        jsonLdEvent = data;
      } else if (data['@graph'] && Array.isArray(data['@graph'])) {
        const found = data['@graph'].find(checkObj);
        if (found) jsonLdEvent = found;
      }
    } catch (e) {}
  });

  // ----------------------------------------------------
  // 2. Extract Name
  // ----------------------------------------------------
  let name = '';
  if (jsonLdEvent?.name) {
    name = String(jsonLdEvent.name).trim();
  }
  if (!name) {
    name = $('meta[property="og:title"]').attr('content') ||
           $('meta[name="twitter:title"]').attr('content') ||
           $('title').text().trim() ||
           $('h1').first().text().trim();
  }
  // Clean title suffixes like "| Devpost", "| Devfolio", "- Unstop"
  name = name.replace(/\s*([|–—-])\s*(Devfolio|Devpost|Unstop|HackerEarth|Eventopia|Dare2Compete).*$/i, '').trim();

  if (!name || name.length < 3) return null;

  // ----------------------------------------------------
  // 3. Extract Place & Mode
  // ----------------------------------------------------
  let place = '';
  let mode = 'unknown';

  if (jsonLdEvent) {
    // Check eventAttendanceMode
    const modeStr = String(jsonLdEvent.eventAttendanceMode || '').toLowerCase();
    if (modeStr.includes('online')) {
      mode = 'online';
    } else if (modeStr.includes('offline') || modeStr.includes('physical')) {
      mode = 'offline';
    } else if (modeStr.includes('mixed')) {
      mode = 'both';
    }

    // Check location
    const loc = jsonLdEvent.location;
    if (loc) {
      if (typeof loc === 'string') {
        place = loc;
      } else if (loc.name || loc.address) {
        const addr = loc.address;
        const parts = [];
        if (loc.name && !loc.name.toLowerCase().includes('online')) parts.push(loc.name);
        if (typeof addr === 'string') {
          parts.push(addr);
        } else if (addr && typeof addr === 'object') {
          if (addr.addressLocality) parts.push(addr.addressLocality);
          if (addr.addressRegion) parts.push(addr.addressRegion);
        }
        if (parts.length > 0) {
          place = parts.join(', ');
          mode = 'offline';
        }
      }
    }
  }

  const bodyText = plainText($('body').html());

  // If place not found from JSON-LD, look in DOM
  if (!place || place === 'Online') {
    // Check "Happening", "Venue", "Location", "Place"
    const venueMatch = bodyText.match(/(?:Happening|Venue|Location|Place)\s*[:\n]\s*([A-Za-z0-9\s,.-]{3,80})/i);
    if (venueMatch) {
      const candidate = venueMatch[1].replace(/\n.*$/g, '').trim();
      if (!/^(online|virtual|tba|tbd|remote)/i.test(candidate)) {
        place = candidate;
        mode = 'offline';
      }
    }
  }

  // Resolve abbreviated venue cards using another mention of the same institution.
  // Do not borrow an unrelated organizer's state from elsewhere on the page.
  if (place) {
    const institution = place.split(',')[0].toLowerCase().trim();
    if (institution.length > 12) {
      const fuller = bodyText.split('\n').find(line =>
        line.toLowerCase().includes(institution) && /\b(kerala|thrissur|kochi|kannur|kottayam|chennai|karnataka|tamil nadu)\b/i.test(line));
      if (fuller) place = fuller.trim();
    }
  }

  // ----------------------------------------------------
  // 4. Extract Registration End Date (Deadline)
  // ----------------------------------------------------
  let registrationEndDate = null;

  // A. Check countdown timer in text ("Applications close in 1d:15h" or "5 days left")
  const countdownMatch = bodyText.match(/(?:applications? close in|closes in|registration closes in|deadline in|ends in)\s*([^\n.,]{2,30})/i);
  if (countdownMatch) {
    const fromCountdown = parseCountdownToDate(countdownMatch[1]);
    if (fromCountdown) {
      registrationEndDate = fromCountdown;
    }
  }

  // B. Check countdown elements with "days left"
  if (!registrationEndDate) {
    const daysLeftMatch = bodyText.match(/(\d+)\s*d(?:ays?)?\s*(?:\d+\s*h(?:ours?)?)?\s*left/i);
    if (daysLeftMatch) {
      const fromDaysLeft = parseCountdownToDate(daysLeftMatch[0]);
      if (fromDaysLeft) {
        registrationEndDate = fromDaysLeft;
      }
    }
  }

  // C. Check explicit date labels in page text
  if (!registrationEndDate) {
    const deadlineTextMatch = bodyText.match(/(?:registration deadline|last date to register|register by|application deadline|registration closes(?: on)?|registration ends(?: on)?|submissions close(?: on)?|deadline)\s*[:\-–]?\s*([A-Za-z0-9 ,./-]{4,35})/i);
    if (deadlineTextMatch) {
      const candidateDate = parseDateToYMD(deadlineTextMatch[1]);
      if (candidateDate) {
        registrationEndDate = candidateDate;
      }
    }
  }

  // Timeline cards can put "SEP 23" before "REGISTRATION CLOSES".
  // Infer a missing year only from an explicit event date on this page.
  if (!registrationEndDate) {
    const eventYear = String(jsonLdEvent?.startDate || '').match(/20\d{2}/)?.[0] ||
      bodyText.match(/\b(?:Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+\d{1,2}(?:\s*[-–,]\s*\d{1,2})*,?\s+(20\d{2})\b/i)?.[1];
    const lines = bodyText.split('\n').map(x => x.trim()).filter(Boolean);
    const label = /^(?:registration(?:s)?|applications?)\s+(?:closes?|ends?|deadline|last date)(?:\s+(?:on|at))?\s*[:–-]?$/i;
    for (let i = 0; i < lines.length; i++) {
      if (!label.test(lines[i])) continue;
      for (const candidate of [lines[i - 1], lines[i + 1]]) {
        if (!candidate || !/^(?:[A-Za-z]+\s+\d{1,2}|\d{1,2}\s+[A-Za-z]+)(?:,?\s+20\d{2})?$/.test(candidate)) continue;
        const dated = /20\d{2}/.test(candidate) ? candidate : (eventYear ? `${candidate} ${eventYear}` : '');
        const parsed = parseDateToYMD(dated);
        if (parsed) { registrationEndDate = parsed; break; }
      }
      if (registrationEndDate) break;
    }
  }

  // D. Explicit registration validity only; event start is not a registration deadline.
  if (!registrationEndDate && jsonLdEvent) {
    if (jsonLdEvent.offers?.validThrough) {
      registrationEndDate = parseDateToYMD(jsonLdEvent.offers.validThrough);

    }
  }

  // E. Check Next.js / React script tags for reg_ends_at or dates
  if (!registrationEndDate) {
    $('script').each((_, el) => {
      const content = $(el).html() || '';
      if (content.includes('reg_ends_at') || content.includes('end_regn_dt')) {
        const match = content.match(/"(?:reg_ends_at|end_regn_dt)"\s*:\s*"([^"]+)"/);
        if (match) {
          const parsed = parseDateToYMD(match[1]);
          if (parsed) {
            registrationEndDate = parsed;
            return false; // Break
          }
        }
      }
    });
  }

  // Filter: Event must have valid future/today registration end date
  if (!registrationEndDate) {
    if (options.diagnostics) options.diagnostics.reason = 'missing-registration-deadline';
    return null;
  }

  const now = options.now || new Date();
  const todayYMD = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (registrationEndDate < todayYMD) {
    if (options.diagnostics) options.diagnostics.reason = 'expired-registration-deadline';
    return null;
  }

  let fee = 'Free';
  const feeMatch = bodyText.match(/(?:registration fee[s]?|entry fee|participation fee|ticket price)\s*[:\-–]?\s*([₹Rs\.]*\s*[\d,]+)/i);
  if (feeMatch) {
    fee = feeMatch[1].trim();
  }

  const desc = $('meta[property="og:description"]').attr('content') ||
               $('meta[name="description"]').attr('content') ||
               $('p').first().text().trim().slice(0, 300);

  const attendance = classifyAttendance({ name, location: place, mode }, bodyText);
  return {
    name: name,
    place: attendance.location.replace(/\s+/g, ' ').trim(),
    mode: attendance.mode,
    attendanceAnalyzed: true,
    attendanceEvidence: attendance.attendanceEvidence,
    fee: fee,
    registrationDeadline: registrationEndDate,
    startDate: registrationEndDate,
    description: desc || null,
    sourceUrl: pageUrl
  };
}

module.exports = {
  parseDateToYMD,
  parseCountdownToDate,
  parseExactHackathonPage
};
