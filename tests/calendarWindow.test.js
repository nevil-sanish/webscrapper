const test = require('node:test');
const assert = require('node:assert/strict');
const { calendarWindow } = require('../scraper/utils/calendar');

const now = new Date('2026-09-23T13:45:00+05:30');

test('the entry spans the registration deadline through the last day of the event', () => {
  assert.deepEqual(calendarWindow({
    startDate: '2026-09-23', registrationDeadline: '2026-09-23',
    eventConductedDate: '2026-10-01', eventEndDate: '2026-10-03'
  }, now), { start: '2026-09-23', lastDay: '2026-10-03', end: '2026-10-04' });
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

test('an event that finished is dropped, and a deadline with no event dates stays single-day', () => {
  assert.equal(calendarWindow({ startDate: '2026-09-10', eventEndDate: '2026-09-22' }, now), null);
  assert.deepEqual(calendarWindow({ startDate: '2026-10-05' }, now),
    { start: '2026-10-05', lastDay: '2026-10-05', end: '2026-10-06' });
});

test('Date objects from deduplication and timestamps are read in the event timezone', () => {
  assert.deepEqual(calendarWindow({ startDate: new Date('2026-09-30'), endDate: new Date('2026-10-02T16:00:00+05:30') }, now),
    { start: '2026-09-30', lastDay: '2026-10-02', end: '2026-10-03' });
  // 18:30 UTC is midnight in Asia/Kolkata: the event ends on the 28th, not the 27th.
  assert.equal(calendarWindow({ startDate: '2026-09-25', eventEndDate: '2026-09-27T18:30:00.000Z' }, now).lastDay, '2026-09-28');
});

test('an absurd end date collapses to a single day instead of banding the calendar', () => {
  assert.deepEqual(calendarWindow({ startDate: '2026-09-25', eventEndDate: '2027-12-31' }, now),
    { start: '2026-09-25', lastDay: '2026-09-25', end: '2026-09-26' });
});

test('an entry with no usable deadline is skipped', () => {
  assert.equal(calendarWindow({ name: 'No dates' }, now), null);
});
