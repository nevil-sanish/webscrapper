const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyAttendance, shouldKeepHackathon, contentText } = require('../scraper/utils/eventPolicy');
const { deduplicateHackathons } = require('../scraper/utils/dedup');
const { parseExactHackathonPage } = require('../scraper/utils/pageParser');
const { keralaDistricts, keralaKeywords, searchKeywords } = require('../scraper/search/keywordList');

test('online events need no prize, irrespective of location', () => {
  for (const location of ['', 'Online', 'Delhi']) {
    assert.equal(shouldKeepHackathon({ mode: 'online', location, prize: null }), true);
  }
});
test('offline and hybrid events require an allowed physical location', () => {
  for (const mode of ['offline', 'hybrid', 'both']) {
    for (const location of ['Kochi', 'Kannaur', 'Kasargod', 'Chennai', 'Bengaluru']) {
      assert.equal(shouldKeepHackathon({ mode, location }), true);
    }
    for (const location of ['', 'Online', 'Delhi', 'Hyderabad', 'Salem, USA', 'Kochi, Maharashtra']) {
      assert.equal(shouldKeepHackathon({ mode, location, prize: '100000' }), false);
    }
  }
});
test('offline finals override online first round and organizer location', () => {
  const h = { mode: 'online', location: 'Kochi', description: 'Organized in Kerala.' };
  const result = classifyAttendance(h, '<p>Round 1: online.</p><p>Round 2: offline at Hyderabad, Telangana.</p>');
  assert.equal(result.mode, 'offline');
  assert.equal(shouldKeepHackathon(result), false);
  const local = classifyAttendance(h, 'Round 1 online. Grand final offline at Kannur, Kerala.');
  assert.equal(shouldKeepHackathon(local), true);
});
test('structured round details and separate venue labels are inspected', () => {
  const text = contentText([{ title: 'Round 1 online' }, { title: 'Round 2 offline', description: '<p>Venue: Kottayam, Kerala</p>' }]);
  const result = classifyAttendance({ mode: 'online', location: 'Online' }, text);
  assert.equal(result.mode, 'offline');
  assert.equal(shouldKeepHackathon(result), true);
});
test('negated offline attendance and physical prizes do not exclude online events', () => {
  for (const text of ['Entirely online. No offline rounds.', 'Online hackathon with physical prizes.']) {
    assert.equal(classifyAttendance({ mode: 'online' }, text).mode, 'online');
  }
});
test('unrelated Kerala description does not admit an outside venue', () => {
  assert.equal(shouldKeepHackathon({ mode: 'offline', location: 'Delhi', description: 'Open to Kerala students' }), false);
});
test('offline evidence survives deduplication in either source order', () => {
  const online = classifyAttendance({ name: 'Sample Hack', mode: 'online', location: 'Online', startDate: '2029-12-01' });
  const offline = classifyAttendance({ ...online, attendanceAnalyzed: false }, 'Final round offline at Delhi.');
  for (const events of [[online, offline], [offline, online]]) {
    const merged = deduplicateHackathons(events);
    assert.equal(merged.length, 1);
    assert.equal(shouldKeepHackathon(merged[0]), false);
  }
});
test('exact-page parser uses full round text beyond the summary', () => {
  const parsed = parseExactHackathonPage(`<html><h1>Example Hackathon</h1><p>Registration deadline: 2029-12-01</p><p>Online first round.</p><p>${'Details '.repeat(100)}</p><p>Final round offline at Thrissur, Kerala.</p></html>`, 'https://example.com/hack');
  assert.ok(parsed);
  assert.equal(parsed.mode, 'offline');
  assert.match(parsed.place, /Thrissur/);
});
test('all Kerala districts are searched each run with overwhelming Kerala priority', () => {
  assert.equal(keralaDistricts.length, 14);
  for (const district of keralaDistricts) {
    assert.ok(searchKeywords.some(q => q.includes(`hackathon in ${district} Kerala`)));
    assert.ok(searchKeywords.some(q => q.includes(`site:unstop.com hackathon ${district}`)));
    assert.ok(searchKeywords.some(q => q.includes(`site:devfolio.co hackathon ${district}`)));
  }
  assert.ok(keralaKeywords.length / searchKeywords.length > 0.9);
  assert.ok(searchKeywords.every(q => /Kerala|Tamil Nadu|Karnataka/.test(q)));
});

test('hybrid and onsite wording in page content count as offline', () => {
  for (const text of ['Hybrid hackathon. Venue: Chennai, Tamil Nadu.', 'Final round onsite at Bengaluru, Karnataka.']) {
    const result = classifyAttendance({ mode: 'online', location: 'Online' }, text);
    assert.equal(result.mode, 'offline');
    assert.equal(shouldKeepHackathon(result), true);
  }
});
