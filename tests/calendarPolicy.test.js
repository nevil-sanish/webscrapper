const test = require('node:test');
const assert = require('node:assert/strict');
const { originalName, calendarSummary, isRegistrationClosed, isPastEvent } = require('../scraper/utils/calendarPolicy');
const { getEventColorId, maintainCalendar } = require('../scraper/utils/calendar');
const description = 'Mode: offline\nLocation: Thrissur, Kerala\nLink: https://example.org/hackathon';
const now = new Date('2026-09-18T06:00:00Z');

test('Kerala green overrides mode; other online blue and offline red', () => {
  for (const mode of ['offline', 'online', 'hybrid']) assert.equal(getEventColorId({ location: 'Kasaragod', mode }), '10');
  assert.equal(getEventColorId({ location: 'Online', mode: 'online' }), '9');
  assert.equal(getEventColorId({ location: 'Chennai', mode: 'offline' }), '11');
});
test('Kerala titles sort first and title migration is idempotent', () => {
  const kerala = calendarSummary({ name: 'Z Hack', location: 'Kochi' });
  const other = calendarSummary({ name: 'A Hack', location: 'Online' });
  assert.deepEqual([other, kerala].sort(), [kerala, other]);
  assert.equal(originalName(kerala), 'Z Hack');
  assert.equal(calendarSummary({ name: kerala, location: 'Kochi' }), kerala);
});
test('past cleanup respects exclusive all-day end, timezone, personal and recurring entries', () => {
  assert.equal(isPastEvent({ description, end: { date: '2026-09-18' } }, now), true);
  assert.equal(isPastEvent({ description, end: { date: '2026-09-19' } }, now), false);
  assert.equal(isPastEvent({ description, end: { dateTime: '2026-09-17T18:30:00Z' } }, now), true);
  assert.equal(isPastEvent({ description, end: { dateTime: '2026-09-17T20:00:00Z' } }, now), false);
  assert.equal(isPastEvent({ description: 'Personal appointment', end: { date: '2026-09-17' } }, now), false);
  assert.equal(isPastEvent({ description, recurrence: ['RRULE:FREQ=DAILY'], end: { date: '2026-09-17' } }, now), false);
});
test('registration cleanup reads the deadline, falls back to old entry starts, and respects the calendar day', () => {
  const managed = { description: `${description}\nRegistration Deadline: 17 Sep 2026`,
    start: { date: '2026-09-20' }, end: { date: '2026-10-05' } };
  assert.equal(isRegistrationClosed(managed, now), true);
  assert.equal(isRegistrationClosed({ ...managed, description: `${description}\nRegistration Deadline: 18 Sep 2026` }, now), false);
  assert.equal(isRegistrationClosed({ description, start: { date: '2026-09-17' } }, now), true);
  assert.equal(isRegistrationClosed({ description, start: { date: '2026-09-18' } }, now), false);
  assert.equal(isRegistrationClosed({ description, start: { dateTime: '2026-09-17T18:30:00Z' } }, now), false);
  assert.equal(isRegistrationClosed({ description, start: { dateTime: '2026-09-17T18:30:00Z' } }, now, 'UTC'), true);
  assert.equal(isRegistrationClosed({ description: 'Personal appointment', start: { date: '2026-09-17' } }, now), false);
  assert.equal(isRegistrationClosed({ ...managed, recurrence: ['RRULE:FREQ=DAILY'] }, now), false);
});
test('maintenance paginates, deletes closed registrations, recolors upcoming Kerala and preserves personal events', async () => {
  const deletes = []; const patches = []; let lists = 0;
  const client = { events: {
    async list({ pageToken }) {
      lists++;
      return { data: pageToken ? { items: [{ id: 'next', summary: 'HackAthena',
        description: `${description}\nRegistration Deadline: 20 Sep 2026`,
        start: { date: '2026-09-18' }, colorId: '11', end: { date: '2026-09-24' } }] } :
        { nextPageToken: 'next', timeZone: 'Asia/Kolkata', items: [
          { id: 'old', summary: 'Old hackathon', description, end: { date: '2026-09-18' } },
          { id: 'closed', summary: 'Closed hackathon', description: `${description}\nRegistration Deadline: 17 Sep 2026`,
            start: { date: '2026-09-17' }, end: { date: '2026-10-05' } },
          { id: 'legacy', summary: 'Legacy hackathon', description,
            start: { date: '2026-09-17' }, end: { date: '2026-10-05' } },
          { id: 'personal', summary: 'Dentist', end: { date: '2026-09-17' } }] } };
    },
    async delete(x) { deletes.push(x); }, async patch(x) { patches.push(x); }
  } };
  const result = await maintainCalendar({ now, client, calendarId: 'test' });
  assert.deepEqual(result, { deleted: 3, updated: 1 });
  assert.equal(lists, 2);
  assert.deepEqual(deletes.map(x => x.eventId), ['old', 'closed', 'legacy']);
  assert.equal(patches[0].resource.colorId, '10');
  assert.equal(patches[0].resource.summary, '1 · Kerala · HackAthena');
  assert.deepEqual(patches[0].resource.start, { date: '2026-09-20' });
  assert.deepEqual(patches[0].resource.end, { date: '2026-09-21' });
});
test('maintenance reports failed deletes to the GitHub Action', async () => {
  const client = { events: {
    async list() { return { data: { items: [{ id: 'closed', summary: 'Closed hackathon',
      description: `${description}\nRegistration Deadline: 17 Sep 2026`,
      start: { date: '2026-09-17' }, end: { date: '2026-10-05' } }] } }; },
    async delete() { throw new Error('Calendar API unavailable'); }
  } };
  await assert.rejects(maintainCalendar({ now, client, calendarId: 'test' }),
    /Calendar maintenance failed for 1 event/);
});
