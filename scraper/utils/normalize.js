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

// The same hackathon is often listed under two names: "BUiLDX" and "BUiLDX
// Hackathon", "Life After Code" and 'GitLab "Life After Code"', "Make-A-Ton
// 9.0 (Odoo × CUSAT)" and "Odoo × Make-A-Ton 9.0". Case, punctuation, a
// bracketed note and filler words are ignored, and one name may contain the other.
const FILLER = /\b(?:the|a|an|of|hackathons?|hacks?|national|level|edition|20\d\d)\b/g;
function nameKey(name, { keepBrackets = false } = {}) {
  const text = String(name || '').toLowerCase().replace(/×/g, 'x');
  return (keepBrackets ? text : text.replace(/\([^)]*\)/g, ' '))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(FILLER, ' ').replace(/\s+/g, '');
}
function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short === long || (short.length >= 4 && long.includes(short));
}

const linkKey = url => String(url || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/i, '').toLowerCase();
function platformOf(url) {
  const host = linkKey(url).split('/')[0];
  if (host === 'unstop.com') return 'unstop';
  if (host.endsWith('.devfolio.co')) return 'devfolio';
  if (host.endsWith('.devpost.com')) return 'devpost';
  if (host === 'hackindia.org') return 'hackindia';
  return null;
}

/**
 * Two entries are one hackathon when they close on the same day and share a
 * link or a name. Two listings on one platform need the same name outright,
 * bracketed note included: Unstop's "BUiLDX" and "BUiLDX Hackathon" are one
 * event posted twice, but an offline and a "(Virtual)" edition are both real.
 * @param {{name: string, day: string, link?: string}} a
 */
function isSameHackathon(a, b) {
  if (!a.day || a.day !== b.day) return false;
  const [la, lb] = [linkKey(a.link), linkKey(b.link)];
  if (la && la === lb) return true;
  if (la && lb && platformOf(a.link) && platformOf(a.link) === platformOf(b.link)) {
    const [x, y] = [nameKey(a.name, { keepBrackets: true }), nameKey(b.name, { keepBrackets: true })];
    return Boolean(x) && x === y;
  }
  return sameName(a.name, b.name);
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

module.exports = { normalizeDate, normalizeName, checkKeralaRelevance, sameName, isSameHackathon, linkKey };
