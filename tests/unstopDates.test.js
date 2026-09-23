const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveUnstopDates } = require('../scraper/sites/unstop');

// Shape taken from https://unstop.com/api/public/competition/1754867 (YODHA 2.0):
// registration shuts on 23 Sep, the live idea-submission round runs to 26 Sep,
// and the hackathon itself is the offline finale on 1-3 Oct.
const yodha = {
  start_date: '2026-09-13T19:42:00+05:30',
  end_date: '2026-10-03T16:00:00+05:30',
  regnRequirements: { start_regn_dt: '2026-09-13T19:42:00+05:30', end_regn_dt: '2026-09-23T16:00:00+05:30' },
  datesToshow: [{ title: 'Early Bird Registration Ends (Rs 700/Team)', important_date: '2026-09-21 23:59:26+05:30' }],
  rounds: [
    { round_order: 1, title: 'Round 1', details: [{ title: 'Stage 1: Ideathon & PPT Submission', status: 'LIVE', start_date: '2026-09-14T12:00:00+05:30', end_date: '2026-09-26T23:59:00+05:30' }] },
    { round_order: 2, title: 'Round 2', details: [{ title: 'Stage 2: Selection & Confirmation', status: 'NOT_STARTED', start_date: '2026-09-27T23:40:00+05:30', end_date: '2026-09-29T23:40:00+05:30' }] },
    { round_order: 3, title: 'Round 3', details: [{ title: 'Stage 3: Grand Finale (Offline)', status: 'NOT_STARTED', start_date: '2026-10-01T14:00:00+05:30', end_date: '2026-10-03T16:00:00+05:30' }] }
  ]
};

test('the registration window wins over a live submission round and early-bird pricing', () => {
  assert.deepEqual(resolveUnstopDates(yodha), {
    registrationDeadline: '2026-09-23',
    eventConductedDate: '2026-10-01',
    eventEndDate: '2026-10-03'
  });
});

test('rounds supply the deadline only when the registration window is missing', () => {
  const { regnRequirements, ...noWindow } = yodha;
  assert.equal(resolveUnstopDates(noWindow).registrationDeadline, '2026-09-26');

  assert.equal(resolveUnstopDates({
    end_date: '2026-11-02T20:00:00+05:30',
    rounds: [{ details: [
      { title: 'Registration closes', end_date: '2026-10-28T23:59:00+05:30' },
      { title: 'Idea submission', status: 'LIVE', end_date: '2026-10-20T23:59:00+05:30' }
    ] }]
  }).registrationDeadline, '2026-10-28');
});

test('an opportunity without rounds falls back to its own dates', () => {
  assert.deepEqual(resolveUnstopDates({
    start_date: '2026-10-10T10:00:00+05:30',
    end_date: '2026-10-11T18:00:00+05:30',
    regnRequirements: { end_regn_dt: '2026-10-05T23:59:00+05:30' }
  }), {
    registrationDeadline: '2026-10-05',
    eventConductedDate: '2026-10-10',
    eventEndDate: '2026-10-11'
  });
});
