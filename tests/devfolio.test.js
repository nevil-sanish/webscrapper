const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRegistrationDeadline } = require('../scraper/sites/devfolio');

test('Devfolio live countdown overrides a stale indexed registration date', () => {
  const deadline = resolveRegistrationDeadline({
    timerTimestamp: '2026-09-19T18:30:00+05:30',
    bodyText: 'Applications close in 2d:4h:55m',
    now: new Date('2026-09-23T10:00:00+05:30'),
    todayYMD: '2026-09-23',
    countdownParser: () => '2026-09-25'
  });

  assert.equal(deadline, '2026-09-25');
});

test('Devfolio indexed date remains a fallback when no live countdown exists', () => {
  assert.equal(resolveRegistrationDeadline({
    timerTimestamp: '2026-09-25T18:30:00+05:30',
    bodyText: 'Applications are open',
    todayYMD: '2026-09-23'
  }), '2026-09-25');
});
