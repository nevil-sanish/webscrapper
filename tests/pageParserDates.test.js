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

test('a Zoho Backstage page is read from its EDUCATION-typed JSON-LD: venue, ticket fee and a deadline no later than the start', () => {
  const ld = { '@type': 'EDUCATION', name: 'BuildX Hackathon 2026', startDate: '2026-11-04T08:00:00+0530', endDate: '2026-11-05T17:00:00+0530',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: { '@type': 'Place', name: 'B. S. Abdur Rahman Crescent Institute Of Science And Technology',
      address: { addressLocality: 'Vandalur', addressRegion: 'IN', postalCode: '600048' } },
    offers: [{ name: 'Confirm Participation', price: 1017, priceCurrency: 'INR', validThrough: '2026-11-05T17:00:00+0530' }] };
  const html = `<html><head><title>BuildX Hackathon 2026</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body></body></html>`;
  const h = parseExactHackathonPage(html, 'https://tevents.t-hub.co/x', { now: new Date('2026-10-20T06:00:00Z') });
  assert.equal(h.name, 'BuildX Hackathon 2026');
  assert.equal(h.mode, 'offline');
  assert.match(h.place, /Vandalur/);
  assert.equal(h.registrationDeadline, '2026-11-04');
  assert.equal(h.fee, '₹1017');
  const { shouldKeepHackathon } = require('../scraper/utils/eventPolicy');
  assert.equal(shouldKeepHackathon({ ...h, location: h.place }), true);
});
