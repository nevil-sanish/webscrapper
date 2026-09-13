const stringSimilarity = require('string-similarity');
const { normalizeName, normalizeDate } = require('./normalize');

/**
 * Deduplicates an in-memory array of scraped hackathon objects.
 * Merges missing details across duplicate entries.
 * @param {Array} hackathons - List of newly scraped hackathon objects
 * @returns {Array} - Deduplicated array of hackathon objects
 */
function deduplicateHackathons(hackathons) {
  const uniqueList = [];

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  for (let h of hackathons) {
    if (!h || !h.name || typeof h.name !== 'string') continue;

    const dateNew = normalizeDate(h.startDate);
    const dateEnd = normalizeDate(h.endDate);

    // Skip events that completed in the past
    const latestDate = dateEnd || dateNew;
    if (latestDate && new Date(latestDate) < today) {
      continue;
    }

    const normNameNew = normalizeName(h.name);

    let match = null;

    for (let ex of uniqueList) {
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
      // Merge details if missing or default
      const fields = ['endDate', 'registrationDeadline', 'organizer', 'prize', 'eligibility', 'description'];
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
        mode: h.mode || 'unknown',
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
