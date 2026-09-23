const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExactHackathonPage } = require('../scraper/utils/pageParser');

test('page parser keeps event dates separate from the registration deadline', () => {
  const html = `<html><title>DEFINE 4.0</title>
    <script type="application/ld+json">${JSON.stringify({
      '@type': 'Event', name: 'DEFINE 4.0', startDate: '2026-10-09', endDate: '2026-10-10',
      location: 'Thiruvananthapuram, Kerala', offers: { validThrough: '2026-09-22' }
    })}</script><body>Hackathon</body></html>`;
  const parsed = parseExactHackathonPage(html, 'https://example.org/define', { now: new Date('2026-09-18') });
  assert.equal(parsed.registrationDeadline, '2026-09-22');
  assert.equal(parsed.eventConductedDate, '2026-10-09');
  assert.equal(parsed.eventEndDate, '2026-10-10');
});
