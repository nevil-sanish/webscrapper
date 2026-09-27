const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarWindow } = require('../scraper/utils/calendar');

const now = new Date('2026-09-23T13:45:00+05:30');

test('the entry occupies only the registration deadline, even when the hackathon lasts longer', () => {
  assert.deepEqual(calendarWindow({
    startDate: '2026-09-24', registrationDeadline: '2026-09-23',
    eventConductedDate: '2026-10-01', eventEndDate: '2026-10-03'
  }, now), { start: '2026-09-23', end: '2026-09-24' });
});

test('a hackathon is skipped after registration closes, even if the event is still running', () => {
  assert.equal(calendarWindow({
    startDate: '2026-09-19', eventConductedDate: '2026-09-24', eventEndDate: '2026-09-25'
  }, now), null);
  assert.equal(calendarWindow({
    startDate: '2026-09-19', registrationDeadline: '2026-09-19',
    eventConductedDate: '2026-09-24', eventEndDate: '2026-09-25'
  }, now), null);
});

test('an expired deadline is dropped, and a deadline with no event dates stays single-day', () => {
  assert.equal(calendarWindow({ startDate: '2026-09-10', eventEndDate: '2026-09-22' }, now), null);
  assert.deepEqual(calendarWindow({ startDate: '2026-10-05' }, now),
    { start: '2026-10-05', end: '2026-10-06' });
});

test('Date objects and timestamps use the event timezone for the deadline', () => {
  assert.deepEqual(calendarWindow({ startDate: new Date('2026-09-30'), endDate: new Date('2026-10-02T16:00:00+05:30') }, now),
    { start: '2026-09-30', end: '2026-10-01' });
  // 18:30 UTC is midnight in Asia/Kolkata.
  assert.deepEqual(calendarWindow({ registrationDeadline: '2026-09-27T18:30:00.000Z' }, now),
    { start: '2026-09-28', end: '2026-09-29' });
});

test('an entry with no usable deadline is skipped', () => {
  assert.equal(calendarWindow({ name: 'No dates' }, now), null);
});
