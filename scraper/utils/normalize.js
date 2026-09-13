/**
 * Normalizes dates and string fields
 */

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

/**
 * Checks if the location or tags indicate it's relevant to Kerala students
 */
function checkKeralaRelevance(hackathon) {
  const keralaKeywords = ['kerala', 'kochi', 'trivandrum', 'thiruvananthapuram', 'calicut', 'kozhikode', 'palakkad', 'thrissur', 'kollam', 'kottayam', 'iiitk', 'iiit kottayam', 'cusat', 'nitc', 'cet'];
  
  const searchStr = `${hackathon.location || ''} ${hackathon.name || ''} ${(hackathon.tags || []).join(' ')}`.toLowerCase();
  
  for (let kw of keralaKeywords) {
    if (searchStr.includes(kw)) {
      return true;
    }
  }
  
  // If it's online, it's relevant to students everywhere including Kerala
  if (searchStr.includes('online') || searchStr.includes('virtual')) {
    return true;
  }

  return false;
}

module.exports = { normalizeDate, normalizeName, checkKeralaRelevance };
