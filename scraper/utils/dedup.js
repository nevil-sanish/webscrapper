const stringSimilarity = require('string-similarity');
const { normalizeName, normalizeDate } = require('./normalize');

/**
 * Deduplicates and upserts hackathons into MongoDB
 * @param {Array} newHackathons - List of newly scraped hackathon objects
 * @param {Model} HackathonModel - Mongoose model
 * @returns {Object} - Results { inserted: [], updated: [] }
 */
async function deduplicateAndUpsert(newHackathons, HackathonModel) {
  const results = { inserted: [], updated: [] };
  
  // Fetch existing future or recent hackathons to compare against to avoid loading whole DB
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  
  // We fetch mostly recent ones to dedup, but let's fetch all for safety if DB is small.
  // In production, limit this query to e.g. startDate >= today - some margin
  const existingDocs = await HackathonModel.find({});

  for (let h of newHackathons) {
    if (!h.name) continue;

    const normNameNew = normalizeName(h.name);
    const dateNew = normalizeDate(h.startDate);

    let matchFound = null;

    for (let ex of existingDocs) {
      const normNameEx = normalizeName(ex.name);
      const similarity = stringSimilarity.compareTwoStrings(normNameNew, normNameEx);

      if (similarity > 0.85) {
        // Names are very similar. Check dates if both exist
        const dateEx = ex.startDate;
        if (dateNew && dateEx) {
          const diffDays = Math.abs((dateNew - dateEx) / (1000 * 60 * 60 * 24));
          if (diffDays <= 3) {
            matchFound = ex;
            break;
          }
        } else {
          // If one date is missing but name is >85% similar, treat as match
          matchFound = ex;
          break;
        }
      }
    }

    if (matchFound) {
      // Update existing document
      let updated = false;
      
      // Merge newly found fields if they were null
      const fields = ['endDate', 'registrationDeadline', 'location', 'organizer', 'prize', 'eligibility', 'description'];
      for (let field of fields) {
        if (!matchFound[field] && h[field]) {
          matchFound[field] = h[field];
          updated = true;
        }
      }
      
      // Merge tags safely
      if (h.tags && h.tags.length > 0) {
        const existingTags = new Set(matchFound.tags || []);
        let addedTag = false;
        h.tags.forEach(t => {
          if (!existingTags.has(t)) {
            matchFound.tags.push(t);
            addedTag = true;
          }
        });
        if (addedTag) updated = true;
      }

      matchFound.lastUpdatedAt = new Date();
      await matchFound.save();
      
      if (updated) {
        results.updated.push(matchFound);
      }
    } else {
      // Insert new document
      const hDoc = new HackathonModel({
        name: h.name,
        source: h.source || 'search',
        sourceUrl: h.sourceUrl,
        startDate: dateNew,
        endDate: normalizeDate(h.endDate),
        registrationDeadline: normalizeDate(h.registrationDeadline),
        location: h.location,
        organizer: h.organizer,
        prize: h.prize,
        eligibility: h.eligibility,
        tags: h.tags || [],
        description: h.description,
        isKeralaRelevant: h.isKeralaRelevant
      });
      
      try {
        await hDoc.save();
        existingDocs.push(hDoc); // Add to local cache for subsequent dedup in same run
        results.inserted.push(hDoc);
      } catch (err) {
        console.error(`Error inserting hackathon ${h.name}:`, err.message);
      }
    }
  }

  return results;
}

module.exports = { deduplicateAndUpsert };
