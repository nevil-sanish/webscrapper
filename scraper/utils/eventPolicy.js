const cheerio = require('cheerio');
const ALLOWED_STATES_CITIES = [
      'kerala', 'tamil nadu', 'tamilnadu', 'karnataka',
      'kochi', 'cochin', 'ernakulam', 'trivandrum', 'thiruvananthapuram', 'kozhikode', 'calicut', 'thrissur', 'trichur',
      'kollam', 'quilon', 'kottayam', 'palakkad', 'palghat', 'kannur', 'cannanore', 'malappuram', 'alappuzha', 'alleppey',
      'kasaragod', 'wayanad', 'idukki', 'pathanamthitta', 'karunagappally', 'kothamangalam', 'nilambur', 'nalanchira', 'thodiyoor',
      'chennai', 'madras', 'coimbatore', 'kovai', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'tirunelveli',
      'erode', 'vellore', 'thanjavur', 'dindigul', 'tiruppur', 'tirupur', 'kanchipuram', 'kancheepuram', 'karur', 'nagercoil',
      'hosur', 'theni', 'sivakasi', 'virudhunagar', 'kattankulathur', 'cuddalore', 'kumbakonam', 'pollachi',
      'bengaluru', 'bangalore', 'mysuru', 'mysore', 'mangaluru', 'mangalore', 'hubballi', 'hubli', 'belagavi',
      'belgaum', 'udupi', 'shivamogga', 'shimoga', 'davanagere', 'ballari', 'bellary', 'gulbarga',
      'kalaburagi', 'tumkur', 'tumakuru', 'dharwad', 'bidar', 'hassan'
    ];


const KERALA_PLACES = ALLOWED_STATES_CITIES.slice(0, ALLOWED_STATES_CITIES.indexOf('chennai'))
  .filter(x => !['tamil nadu', 'tamilnadu', 'karnataka'].includes(x))
  .concat(['kasargod', 'kannaur']);
ALLOWED_STATES_CITIES.push('kasargod', 'kannaur');
const matches = (text, terms) => terms.some(t => new RegExp(`\\b${t}\\b`, 'i').test(text));
const isGeneric = value => /^(online|virtual|remote|in-person|offline|hybrid|both|unknown|tba|tbd)?$/i.test((value || '').trim());

function plainText(html) {
  const $ = cheerio.load(String(html || ''));
  $('script, style, nav, footer').remove();
  $('br').replaceWith('\n');
  $('p, div, li, section, h1, h2, h3, tr').append('\n');
  return $.root().text().replace(/[ \t]+/g, ' ');
}

// Analyze complete event content before descriptions are shortened.
function classifyAttendance(event, content = '') {
  if (event.attendanceAnalyzed && !content) return event;
  const text = plainText(content || event.description || '');
  const lines = text.split(/[\n.!?]+/).map(x => x.trim()).filter(Boolean);
  const physical = /\b(?:offline|in[ -]person|on[ -]?site|on[ -]?campus|hybrid|physical(?:ly)?[ -]+(?:round|final|event|attendance|presence))\b/i;
  const evidence = lines.filter(line => physical.test(line) &&
    !/\b(?:no|not|without)\s+(?:(?:an?|any)\s+)?(?:offline|in[ -]person|physical)/i.test(line));
  const mode = String(event.mode || '').toLowerCase();
  const location = String(event.location || event.place || '').trim();
  const isOffline = evidence.length > 0 || /^(offline|in-person|both|hybrid)$/.test(mode) ||
    (!isGeneric(location) && mode !== 'online' && mode !== 'virtual');
  const venueLines = lines.filter(line => /\b(?:venue|location|held at|held in|takes place at)\b/i.test(line));
  // An explicit physical-round venue overrides an online label or organizer address.
  const roundVenueLine = evidence.find(line => /\b(?:at|in|venue|location)\b/i.test(line));
  const roundVenue = roundVenueLine?.replace(/^.*?\b(?:held at|held in|venue\s*:?|location\s*:?|at|in)\s+/i, '');
  const inferredVenue = roundVenue || (isGeneric(location) ? venueLines.find(line => !/^(?:venue|location)\s*:?$/i.test(line) && !/\b(?:online|virtual)\b/i.test(line)) : '');
  let resolvedLocation = location;
  if (isOffline && inferredVenue) resolvedLocation = inferredVenue;
  if (isOffline && isGeneric(resolvedLocation)) {
    const nearby = evidence.map(line => {
      const i = lines.indexOf(line);
      return lines.slice(i, i + 3).join(' ');
    }).find(line => matches(line, ALLOWED_STATES_CITIES));
    if (nearby) resolvedLocation = nearby;
  }
  return { ...event, mode: isOffline ? 'offline' : (/^(online|virtual)$/.test(mode) || /\b(?:online|virtual|remote)\b/i.test(text) ? 'online' : 'unknown'),
    location: resolvedLocation, attendanceAnalyzed: true, attendanceEvidence: evidence.join(' | '),
    isKeralaRelevant: matches(resolvedLocation, KERALA_PLACES) };
}

function shouldKeepHackathon(event) {
  const h = classifyAttendance(event);
  if (h.mode === 'online') return true;
  if (h.mode !== 'offline' || isGeneric(h.location)) return false;
  // Explicit excluded states take precedence over a matching city or organizer name.
  if (matches(h.location, ['andhra pradesh', 'telangana', 'maharashtra', 'delhi', 'gujarat', 'goa', 'west bengal', 'odisha', 'uttar pradesh', 'madhya pradesh', 'rajasthan', 'punjab', 'haryana', 'bihar', 'jharkhand', 'assam', 'chhattisgarh', 'uttarakhand', 'himachal pradesh', 'sikkim', 'tripura', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'arunachal pradesh', 'puducherry', 'pondicherry', 'jammu', 'kashmir', 'ladakh', 'hyderabad', 'mumbai', 'pune', 'kolkata', 'usa', 'united states', 'united kingdom', 'canada', 'australia', 'singapore', 'germany'])) return false;
  return matches(h.location, ALLOWED_STATES_CITIES);
}
function keralaPriority(event) {
  return matches(event.location || '', KERALA_PLACES) ? 1 : 0;
}
function contentText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return Object.values(value).map(contentText).filter(Boolean).join('\n');
}
module.exports = { classifyAttendance, shouldKeepHackathon, keralaPriority, plainText, contentText };
