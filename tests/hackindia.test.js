const test = require('node:test');
const assert = require('node:assert/strict');
const { upcomingLinks, parseHackIndiaPage } = require('../scraper/sites/hackindia');
const { shouldKeepHackathon } = require('../scraper/utils/eventPolicy');
const { getEventColorId } = require('../scraper/utils/calendar');
const { deduplicateHackathons } = require('../scraper/utils/dedup');

const now = new Date('2026-10-20T06:00:00Z');

test('only hackathons above the Past Hackathons heading are visited', () => {
  const html = `<html><body><h3>Hackathons</h3><a href="/hackathons">All</a>
    <h2>HACK GENESIS 2026</h2><a href="/2026/hack-genesis-2026">View</a>
    <h2>Trending This Week</h2><a href="/2026/agentverse-26">A</a><h3>AgentVerse</h3><a href="/2026/agentverse-26">A</a>
    <a href="/2027/hackindia-chennai-overdrive-2027">C</a><a href="/tags/ai">AI</a>
    <h2>Past Hackathons</h2><a href="/2026/algostorm-20">Old</a><a href="/2024/hackindia-2024">Old</a></body></html>`;
  assert.deepEqual(upcomingLinks(html), [
    'https://hackindia.org/2026/hack-genesis-2026',
    'https://hackindia.org/2026/agentverse-26',
    'https://hackindia.org/2027/hackindia-chennai-overdrive-2027'
  ]);
});

// An event page streams its record inside the Next.js RSC payload, as a JSON string.
function page(record) {
  const payload = `5:["$","div",null,{"event":${JSON.stringify(record)}}]`;
  return `<html><body><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></body></html>`;
}
const record = over => ({
  id: 53, title: 'HackIndia Chennai Overdrive 2027', event_type: 'hackathon', status: 'registration_open', is_cancelled: false,
  location: 'Muthayammal Engineering College', venue_details: 'Kakkaveri, Rasipuram, Namakkal District, Tamil Nadu',
  is_online: false, prize_pool: null, registration_fee: 0, registration_fee_currency: 'INR',
  registration_end_date: '2027-02-10T03:30:00.000Z', start_date: '2027-02-11T03:30:00.000Z', end_date: '2027-02-12T03:30:00.000Z',
  ...over
});

test('a HackIndia page is read from its own record, with the usual filters and colors', () => {
  const chennai = parseHackIndiaPage(page(record()), 'https://hackindia.org/2027/chennai', now);
  assert.equal(chennai.mode, 'offline');
  assert.match(chennai.location, /Namakkal District, Tamil Nadu/);
  assert.equal(chennai.registrationDeadline, '2027-02-10');
  assert.equal(chennai.eventConductedDate, '2027-02-11');
  assert.equal(shouldKeepHackathon(chennai), true);
  assert.equal(getEventColorId(chennai), '11');

  const kochi = parseHackIndiaPage(page(record({ title: 'Spark Kochi', location: 'CUSAT', venue_details: 'Kochi, Kerala' })), 'https://hackindia.org/2026/k', now);
  assert.equal(getEventColorId(kochi), '10');

  const delhi = parseHackIndiaPage(page(record({ title: 'T HACKS 9.0', location: 'ADGIPS College, Delhi', venue_details: 'NEW DELHI' })), 'https://hackindia.org/2026/t', now);
  assert.equal(shouldKeepHackathon(delhi), false);

  const online = over => parseHackIndiaPage(page(record({ title: 'AgentVerse', is_online: true, location: null, venue_details: null, ...over })), 'https://hackindia.org/2026/a', now);
  assert.equal(shouldKeepHackathon(online({ prize_pool: '₹5000 + 30K Sharp Tokens' })), true);
  assert.equal(getEventColorId(online({ prize_pool: '₹5000' })), '9');
  assert.equal(shouldKeepHackathon(online({ prize_pool: '₹5000', registration_fee: 100 })), true);
  assert.equal(getEventColorId(online({ prize_pool: '₹5000', registration_fee: 100 })), '3');
  assert.equal(getEventColorId(online({ prize_pool: null })), '3');
});

test('closed, cancelled and non-hackathon HackIndia events are skipped with a reason', () => {
  const url = 'https://hackindia.org/2026/x';
  assert.match(parseHackIndiaPage(page(record({ status: 'registration_closed' })), url, now), /registration closed/);
  assert.match(parseHackIndiaPage(page(record({ registration_end_date: '2026-10-18T10:00:00.000Z' })), url, now), /registration closed/);
  assert.equal(parseHackIndiaPage(page(record({ is_cancelled: true })), url, now), 'cancelled');
  assert.match(parseHackIndiaPage(page(record({ event_type: 'expo' })), url, now), /not a hackathon/);
  assert.equal(parseHackIndiaPage('<html></html>', url, now), 'no event data on the page');
});

test('a HackIndia hackathon also listed elsewhere under a near name is added once', () => {
  const hi = parseHackIndiaPage(page(record({ title: 'HackIndia Chennai Overdrive 2027' })), 'https://hackindia.org/2027/chennai', now);
  const elsewhere = { ...hi, name: 'Chennai Overdrive 2027 (HackIndia)', source: 'unstop', sourceUrl: 'https://unstop.com/hackathons/overdrive-1' };
  assert.equal(deduplicateHackathons([hi, elsewhere]).length, 1);
});
