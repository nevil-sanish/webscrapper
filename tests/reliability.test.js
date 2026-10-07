const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { scrapeUnstop, parseUnstopCompetition } = require('../scraper/sites/unstop');
const { classifyAttendance, shouldKeepHackathon } = require('../scraper/utils/eventPolicy');
const { deduplicateHackathons } = require('../scraper/utils/dedup');
const { isHackathon } = require('../scraper/utils/hackathonType');
const { localDay } = require('../scraper/utils/calendarPolicy');

const open = { end_regn_dt: '2030-10-04T23:59:00+05:30' };
const today = '2030-09-28';

// Shape taken from https://unstop.com/api/public/competition/1761959.
const techashy = {
  title: 'Techashy 2.0 Hackathon 2026',
  region: 'offline',
  details: '<p>A national-level hackathon. Teams build a working prototype.</p>',
  address_with_country_logo: { city: 'Kottayam', state: 'Kerala' },
  regnRequirements: open,
  end_date: '2030-10-11T11:00:00+05:30',
  rounds: [
    { details: [{ title: 'Abstract Submission', start_date: '2030-09-26T16:30:00+05:30', end_date: '2030-10-03T23:59:00+05:30' }] },
    { details: [{ title: 'Offline 24 Hour Hackathon at IIIT Kottayam', start_date: '2030-10-10T11:00:00+05:30', end_date: '2030-10-11T11:00:00+05:30',
      description: 'Shortlisted teams will compete in a 24-hour on-site hackathon, where they will design and present a working prototype.' }] }
  ]
};

test('an offline Kerala hackathon on Unstop is kept with its stated venue and deadline', () => {
  const { event } = parseUnstopCompetition(techashy, { id: 1761959, today });
  assert.equal(event.registrationDeadline, '2030-10-04');
  assert.equal(event.eventConductedDate, '2030-10-10');
  assert.equal(event.location, 'Kottayam, Kerala');
  assert.equal(shouldKeepHackathon(event), true);
  assert.equal(deduplicateHackathons([event]).filter(shouldKeepHackathon).length, 1);
});

test('a skipped Unstop record says why', () => {
  assert.deepEqual(parseUnstopCompetition(null), { skipped: 'no-details' });
  assert.deepEqual(parseUnstopCompetition({ ...techashy, title: 'Campus Quiz' }, { today }), { skipped: 'not-a-hackathon' });
  assert.deepEqual(parseUnstopCompetition(techashy, { today: '2030-10-05' }), { skipped: 'registration-closed' });
});

test('a sentence in the description does not replace the venue the listing states', () => {
  for (const details of [
    '<p>Hackathon held on campus in teams of four. Build a prototype.</p>',
    '<p>Offline hackathon. Download the idea deck in ppt template. Build a product.</p>',
    '<p>In-person hackathon open to students from Delhi and Mumbai. Build a solution.</p>'
  ]) {
    const { event } = parseUnstopCompetition({ title: 'Infothon Hackathon', region: 'offline', details,
      address_with_country_logo: { city: 'Mysuru', state: 'Karnataka' }, regnRequirements: open }, { today });
    assert.equal(event.location, 'Mysuru, Karnataka');
    assert.equal(shouldKeepHackathon(event), true);
  }
});

test("Unstop's own round metadata is not read as in-person attendance", () => {
  const { event } = parseUnstopCompetition({ title: 'Catalyst Hackathon', region: 'online', regnRequirements: open,
    details: '<p>An online hackathon to build solutions.</p>',
    rounds: [{ details: [{ title: 'Idea Submission', seo_data: {
      title: 'Offline Round as part of Catalyst Hackathon', public_url: '/hackathons/catalyst-1/offline-round/2' } }] }]
  }, { today });
  assert.equal(event.mode, 'online');
  assert.equal(shouldKeepHackathon(event), true);
});

test('an online listing stays online when in-person wording names no venue', () => {
  const online = { mode: 'online', location: 'Online' };
  for (const text of [
    'Hybrid grand finale. Teams willing to travel to the venue can participate physically at the venue.',
    'Offline track: optional. Online track: open to all.',
    'Hardware, IoT and hybrid projects are eligible.'
  ]) {
    const result = classifyAttendance(online, text);
    assert.equal(result.mode, 'online', text);
    assert.equal(shouldKeepHackathon(result), true);
  }
  // A named venue outside the allowed states still excludes it.
  const away = classifyAttendance(online, 'Finalists attend the physical round on campus in Ahmedabad.');
  assert.equal(away.mode, 'offline');
  assert.equal(shouldKeepHackathon(away), false);
});

test('two listings on one platform stay separate; the same event from two sources merges', () => {
  const base = { startDate: '2030-10-25', mode: 'online', location: 'Online', attendanceAnalyzed: true };
  const offline = { ...base, name: 'Avishkaar Season 4 Hackathon: A National-Level Innovation Challenge', source: 'unstop',
    sourceUrl: 'https://unstop.com/hackathons/a-1', mode: 'offline', location: 'Tekkali, Andhra Pradesh' };
  const virtual = { ...base, name: 'Avishkaar Season 4 (Virtual) Hackathon: A National-Level Innovation Challenge', source: 'unstop',
    sourceUrl: 'https://unstop.com/hackathons/a-2' };
  const kept = deduplicateHackathons([offline, virtual]).filter(shouldKeepHackathon);
  assert.deepEqual(kept.map(h => h.sourceUrl), ['https://unstop.com/hackathons/a-2']);

  const sameName = ['x', 'y', 'z'].map(id => ({ ...base, name: 'Hackathon', source: 'unstop', sourceUrl: `https://unstop.com/hackathons/${id}` }));
  assert.equal(deduplicateHackathons(sameName).length, 3);

  const elsewhere = { ...virtual, source: 'devfolio', sourceUrl: 'https://avishkaar.devfolio.co' };
  assert.equal(deduplicateHackathons([virtual, elsewhere]).length, 1);
});

test('a deadline that falls today survives deduplication', () => {
  const event = { name: 'Today Hack', startDate: localDay(new Date()), mode: 'online' };
  assert.equal(deduplicateHackathons([event]).length, 1);
});

test('plural "hackathons" in the description identifies a hackathon', () => {
  assert.equal(isHackathon({ name: 'Malanhack' }, 'Unlike conventional coding hackathons, teams build a blueprint.'), true);
});

function unstopApi({ failing = () => false } = {}) {
  const calls = [];
  const get = async url => {
    calls.push(url);
    if (failing(url, calls.filter(u => u === url).length)) {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    }
    if (url.includes('search-result')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return { data: { data: { last_page: 3, data: [{ id: page }] } } };
    }
    const id = url.split('/').pop();
    return { data: { data: { competition: { title: `Hackathon ${id}`, region: 'online',
      regnRequirements: { end_regn_dt: '2099-01-01T23:59:00+05:30' } } } } };
  };
  return { get, calls };
}

test('a listing page that times out once is retried', async () => {
  const originalGet = axios.get;
  const api = unstopApi({ failing: (url, attempt) => url.includes('page=2') && attempt === 1 });
  axios.get = api.get;
  try {
    const results = await scrapeUnstop({ retryDelayMs: 0 });
    assert.deepEqual(results.map(h => h.name), ['Hackathon 1', 'Hackathon 2', 'Hackathon 3']);
    assert.equal(results.stats.complete, true);
  } finally {
    axios.get = originalGet;
  }
});

test('a page that keeps failing is reported and does not end the scan', async () => {
  const originalGet = axios.get;
  const originalError = console.error;
  axios.get = unstopApi({ failing: url => url.includes('page=2') || url.endsWith('/3') }).get;
  console.error = () => {};
  try {
    const results = await scrapeUnstop({ retryDelayMs: 0 });
    assert.deepEqual(results.map(h => h.name), ['Hackathon 1']);
    const { listed, failedPages, failedDetails, complete } = results.stats;
    assert.deepEqual({ listed, failedPages, failedDetails, complete },
      { listed: 2, failedPages: 1, failedDetails: 1, complete: false });
  } finally {
    axios.get = originalGet;
    console.error = originalError;
  }
});

test('a legacy US-format deadline in a calendar entry is read month first', () => {
  const { registrationDeadlineDay } = require('../scraper/utils/calendarPolicy');
  assert.equal(registrationDeadlineDay({ description: 'Mode: offline\nRegistration Deadline: 11/10/2026\n' }), '2026-11-10');
  assert.equal(registrationDeadlineDay({ description: 'Registration Deadline: 10 Nov 2026\n' }), '2026-11-10');
});

test('a venue too small to recognise is resolved from the description', () => {
  const event = classifyAttendance({ mode: 'offline', location: 'Myladi, India' },
    'The 24-hour offline hackathon at Amal College of Advanced Studies, Nilambur, Kerala.');
  assert.match(event.location, /Nilambur, Kerala/);
  assert.equal(shouldKeepHackathon(event), true);
});

test('online hackathons that charge a registration fee are left out', () => {
  const { fromCalendar } = require('../scraper/utils/calendarPolicy');
  for (const fee of ['₹500', 'Rs. 1,500', 'Paid', '200']) {
    assert.equal(shouldKeepHackathon({ mode: 'online', location: 'Online', fee }), false, fee);
  }
  for (const fee of ['Free', '₹0', '', null, undefined]) {
    assert.equal(shouldKeepHackathon({ mode: 'online', location: 'Online', fee }), true, String(fee));
  }
  // An offline event in an allowed state may charge.
  assert.equal(shouldKeepHackathon({ mode: 'offline', location: 'Kochi, Kerala', fee: '₹500' }), true);
  // Maintenance sees the fee of an entry already in the calendar.
  const stored = fromCalendar({ summary: '2 · Paid Hack', description: 'Mode: online\nLocation: Online\nLink: https://x.test\nRegistration Fee: ₹299\n' });
  assert.equal(shouldKeepHackathon(stored), false);
});

test('numeric dates are read the Indian way, day first', () => {
  const { parseDateToYMD } = require('../scraper/utils/pageParser');
  assert.equal(parseDateToYMD('11/10/2026'), '2026-10-11');
  assert.equal(parseDateToYMD('5/11/2026'), '2026-11-05');
  assert.equal(parseDateToYMD('05-11-2026'), '2026-11-05');
  assert.equal(parseDateToYMD('Register by 5.11.2026'), '2026-11-05');
  // Month 24 does not exist: refused, never flipped to the American reading.
  assert.equal(parseDateToYMD('10/24/2026'), null);
});

test('a timestamp without an offset keeps its own day on any machine', () => {
  const { parseDateToYMD } = require('../scraper/utils/pageParser');
  assert.equal(parseDateToYMD('2026-10-15T23:30'), '2026-10-15');
  assert.equal(parseDateToYMD('2026-10-15T00:10:00'), '2026-10-15');
  assert.equal(parseDateToYMD('2026-11-10T18:29:00+00:00'), '2026-11-10');
  assert.equal(parseDateToYMD('2026-11-10T18:31:00Z'), '2026-11-11');
});
