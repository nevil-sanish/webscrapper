const stringSimilarity = require('string-similarity');
const { normalizeName, normalizeDate } = require('./normalize');
const { localDay } = require('./calendarPolicy');

// A platform lists each of its events once, under its own URL. Two of its
// listings are therefore two events however alike they are named: an offline
// and a "(Virtual)" edition, or three colleges each running a "Hackathon".
const PLATFORMS = new Set(['unstop', 'devfolio', 'devpost']);
function separateListings(a, b) {
  return PLATFORMS.has(a.source) && a.source === b.source &&
    Boolean(a.sourceUrl) && Boolean(b.sourceUrl) && a.sourceUrl !== b.sourceUrl;
}

/**
 * Deduplicates an in-memory array of scraped hackathon objects.
 * Merges missing details across duplicate entries.
 * @param {Array} hackathons - List of newly scraped hackathon objects
 * @returns {Array} - Deduplicated array of hackathon objects
 */
function deduplicateHackathons(hackathons) {
  const uniqueList = [];

  // Compared as calendar days in the event timezone, so the machine's own
  // timezone (UTC on CI) cannot expire a deadline that falls today.
  const today = localDay(new Date());

  for (let h of hackathons) {
    if (!h || !h.name || typeof h.name !== 'string') continue;

    const dateNew = normalizeDate(h.startDate);
    const dateEnd = normalizeDate(h.endDate);

    // Skip events that completed in the past
    const latestDate = dateEnd || dateNew;
    if (latestDate && localDay(latestDate) < today) {
      continue;
    }

    const normNameNew = normalizeName(h.name);

    let match = null;

    for (let ex of uniqueList) {
      if (separateListings(h, ex)) continue;
      const normNameEx = normalizeName(ex.name);
      const similarity = stringSimilarity.compareTwoStrings(normNameNew, normNameEx);

      if (similarity > 0.85) {
        const dateEx = ex.startDate;
        if (dateNew && dateEx) {
          const diffDays = Math.abs((new Date(dateNew) - new Date(dateEx)) / (1000 * 60 * 60 * 24));
          if (diffDays <= 3) {
            match = ex;
            break;
          }
        } else {
          match = ex;
          break;
        }
      }
    }

    if (match) {
      if (h.mode === 'offline' || h.mode === 'both' || h.mode === 'hybrid') {
        match.mode = 'offline';
        match.attendanceAnalyzed = h.attendanceAnalyzed;
        match.attendanceEvidence = h.attendanceEvidence;
        if (h.location) match.location = h.location;
      }
      // Merge details if missing or default
      const fields = ['endDate', 'registrationDeadline', 'eventConductedDate', 'eventEndDate',
        'fee', 'daysLeft', 'organizer', 'prize', 'eligibility', 'description'];
      for (let field of fields) {
        if (!match[field] && h[field]) {
          match[field] = h[field];
        }
      }

      if ((!match.location || match.location === 'Online') && h.location && h.location !== 'Online') {
        match.location = h.location;
      }
      if ((!match.mode || match.mode === 'unknown') && h.mode && h.mode !== 'unknown') {
        match.mode = h.mode;
      }

      if (h.isKeralaRelevant) {
        match.isKeralaRelevant = true;
      }

      // Merge tags
      if (h.tags && Array.isArray(h.tags)) {
        const tagSet = new Set(match.tags || []);
        h.tags.forEach(t => tagSet.add(t));
        match.tags = Array.from(tagSet);
      }
    } else {
      uniqueList.push({
        name: h.name.trim(),
        source: h.source || 'search',
        sourceUrl: h.sourceUrl,
        startDate: dateNew,
        endDate: normalizeDate(h.endDate),
        registrationDeadline: normalizeDate(h.registrationDeadline),
        // The event's own dates, kept apart from the registration deadline so
        // the calendar entry can span the days the hackathon actually runs.
        eventConductedDate: h.eventConductedDate || null,
        eventEndDate: h.eventEndDate || null,
        fee: h.fee || null,
        daysLeft: h.daysLeft || null,
        mode: h.mode || 'unknown',
        attendanceAnalyzed: h.attendanceAnalyzed,
        attendanceEvidence: h.attendanceEvidence,
        location: h.location || 'Online',
        organizer: h.organizer,
        prize: h.prize,
        eligibility: h.eligibility,
        tags: Array.isArray(h.tags) ? h.tags : [],
        description: h.description,
        isKeralaRelevant: Boolean(h.isKeralaRelevant)
      });
    }
  }

  return uniqueList;
}

module.exports = { deduplicateHackathons };
