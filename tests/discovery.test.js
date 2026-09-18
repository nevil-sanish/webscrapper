const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { canonicalUrl, scoreCandidate, pageKind, needsBrowser, eventLinks, namedQuery } = require('../scraper/search/candidates');
const { parseExactHackathonPage } = require('../scraper/utils/pageParser');
const { shouldKeepHackathon } = require('../scraper/utils/eventPolicy');
const { isHackathon } = require('../scraper/utils/hackathonType');
const { loadState } = require('../scraper/search/state');
const now = new Date('2026-09-18T06:00:00Z');

test('HackAthena timeline layout resolves deadline year and campus location', () => {
  const html = `<html><title>HackAthena 2.0</title><body>
  <h1>BUILD. CODE. CONQUER.</h1><p>October 5-7, 2026</p>
  <p>Jyothi Engineering College, Thrissur</p><p>48 hour hackathon</p>
  <div>VENUE</div><div>Jyothi Engineering College, Cheruthuruthy</div>
  <p>Offline</p><div>SEP 23</div><div>REGISTRATION CLOSES</div>
  <div>OCT 1</div><div>Payment deadline</div></body></html>`;
  const h = parseExactHackathonPage(html, 'https://hackathena-26.vercel.app/', { now });
  assert.equal(h.name, 'HackAthena 2.0');
  assert.equal(h.registrationDeadline, '2026-09-23');
  assert.match(h.place, /Thrissur/);
  assert.equal(shouldKeepHackathon({ ...h, location: h.place }), true);
  assert.equal(parseExactHackathonPage(html, 'https://example.org', { now: new Date('2026-09-24') }), null);
});
test('timeline without a reliable year is not assigned an invented deadline', () => {
  assert.equal(parseExactHackathonPage('<title>Hackathon</title><body><div>SEP 23</div><div>REGISTRATION CLOSES</div></body>', 'https://example.org', { now }), null);
});
test('unrelated results from the reported run score below event sites', () => {
  for (const item of [
    { url: 'https://kollam.dcourts.gov.in/case-status-search-by-filing-number/', title: 'Case status' },
    { url: 'https://parivahan.gov.in/en/content/vehicle-related-services', title: 'Vehicle registration' },
    { url: 'https://www.makemytrip.com/hotels/the_quilon_beach_hotel', title: 'Quilon beach hotel' }
  ]) assert.ok(scoreCandidate(item, now) < 5);
  assert.ok(scoreCandidate({ url: 'https://hackathena-26.vercel.app', title: 'HackAthena 2026 Jyothi college Thrissur' }, now) > 10);
});
test('listings and tutorials are not events; listings supply official event links', () => {
  const html = '<title>Events | College</title><body><h1>Events</h1><article><a href="https://brand-new.vercel.app">New Kerala Hackathon 2026</a></article><a href="/privacy">Privacy</a></body>';
  assert.equal(pageKind(html), 'listing');
  assert.equal(eventLinks(html, 'https://college.ac.in/events', now)[0].url, 'https://brand-new.vercel.app/');
  assert.equal(eventLinks(html, 'https://college.ac.in/events', now).length, 1);
  assert.equal(pageKind('<title>What is a hackathon?</title>'), 'article');
});
test('large JavaScript shells trigger rendering based on visible content', () => {
  assert.equal(needsBrowser(`<body><div id="root"></div><script>${' '.repeat(5000)}</script></body>`), true);
});
test('URL canonicalization avoids assets, tracking duplicates and local addresses', () => {
  assert.equal(canonicalUrl('https://event.org/?utm_source=feed#about'), 'https://event.org/');
  for (const url of ['https://event.org/poster.pdf', 'http://localhost/test', 'http://192.168.1.1', 'javascript:void(0)']) assert.equal(canonicalUrl(url), null);
  assert.match(namedQuery({ title: "HackAthena'26 | Devfolio" }, 2026), /HackAthena/);
});
test('non-hackathon competition types are rejected even on competition platforms', () => {
  for (const name of ['Python Web Scraper Challenge', 'The Coding Challenge 2026', 'H7CTF 2026', 'Win $500: Get an Agent Passport?', 'AI webinar']) {
    assert.equal(isHackathon({ name, description: 'Solve our challenge and win prizes.' }), false);
  }
  assert.equal(isHackathon({ name: 'HackAthena', description: 'Build projects in a 48 hour hackathon' }), true);
});
test('persistent budgets and caches survive reload, expire, and reset monthly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-test-'));
  const file = path.join(dir, 'state.json');
  try {
    const state = loadState(file, now);
    assert.equal(state.reserve('tavily', 1), true);
    assert.equal(state.reserve('tavily', 1), false);
    state.remember('Kerala hackathon', { provider: 'tavily', urls: [] });
    const restored = loadState(file, now);
    assert.equal(restored.reserve('tavily', 1), false);
    assert.ok(restored.cached('Kerala hackathon'));
    assert.equal(loadState(file, new Date('2026-09-22')).cached('Kerala hackathon'), null);
    assert.equal(loadState(file, new Date('2026-10-01')).reserve('tavily', 1), true);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('event start date alone is never presented as the registration deadline', () => {
  const html = `<title>Example Hackathon</title><script type="application/ld+json">{"@type":"Event","name":"Example Hackathon","startDate":"2026-11-01","location":"Thrissur, Kerala"}</script><body>Build projects.</body>`;
  const diagnostics = {};
  assert.equal(parseExactHackathonPage(html, 'https://example.org', { now, diagnostics }), null);
  assert.equal(diagnostics.reason, 'missing-registration-deadline');
});
test('registration label does not require a colon', () => {
  const html = '<title>Example Hackathon</title><body><p>Registration closes September 23, 2026</p><p>Online hackathon</p></body>';
  assert.equal(parseExactHackathonPage(html, 'https://example.org', { now }).registrationDeadline, '2026-09-23');
});

test('branded summit event directories cannot borrow a child event deadline', () => {
  const html = '<title>IEDC Summit 2026 | Kerala Startup Mission</title><body>Quantum Hackathon. Online. Registration deadline: September 20, 2026</body>';
  assert.equal(pageKind(html, 'https://iedcsummit.in/events'), 'listing');
});

test('discovery entry point supports a zero-budget offline run without Calendar', async () => {
  const { discoverViaSearch } = require('../scraper/search/discovery');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-run-'));
  try {
    const events = await discoverViaSearch({ now, queryLimit: 0, pageLimit: 0, seeds: [],
      stateFile: path.join(dir, 'state.json'), reportFile: path.join(dir, 'report.json'),
      client: { isAvailable: () => false, search: () => assert.fail('must not query') } });
    assert.deepEqual(events, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'report.json'))).accepted, []);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
