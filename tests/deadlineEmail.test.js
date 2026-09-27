const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { matchingDeadlines, sendDeadlineEmail } = require('../scraper/utils/deadlineEmail');
const { loadState } = require('../scraper/search/state');

const now = new Date('2026-09-27T06:00:00Z');
const env = {
  SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_USER: 'sender@example.org',
  SMTP_PASS: 'test-password', REPORT_EMAIL: 'recipient@example.org'
};

function event(name, deadline, { mode = 'offline', location = 'Kochi, Kerala', managed = true } = {}) {
  return {
    id: name,
    summary: name,
    description: managed ? `Mode: ${mode}\nLocation: ${location}\nLink: https://example.org/${name}\nRegistration Deadline: ${deadline}` : 'Personal appointment',
    start: { date: '2026-09-27' },
    end: { date: '2026-10-05' }
  };
}

test('email candidates are only offline Kerala registrations closing today through day three', () => {
  const items = [
    event('Today', '27 Sep 2026'),
    event('Day three', '30 Sep 2026', { mode: 'hybrid' }),
    event('Too late', '01 Oct 2026'),
    event('Closed', '26 Sep 2026'),
    event('Online', '28 Sep 2026', { mode: 'online' }),
    event('Chennai', '28 Sep 2026', { location: 'Chennai, Tamil Nadu' }),
    event('Outside state', '28 Sep 2026', { location: 'Kochi, Maharashtra' }),
    event('Private', '28 Sep 2026', { managed: false }),
    { ...event('Recurring', '28 Sep 2026'), recurrence: ['RRULE:FREQ=DAILY'] },
    event('Day three', '30 Sep 2026', { mode: 'hybrid' })
  ];
  assert.deepEqual(matchingDeadlines(items, now).map(x => x.name), ['Today', 'Day three']);
  assert.deepEqual(matchingDeadlines(items, new Date('2026-09-27T20:00:00Z')).map(x => x.name), ['Day three', 'Too late']);
});

test('an eligible run sends one email, and a fresh run that day sends none', async t => {
  const sent = [];
  let listed = 0;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deadline-email-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'discoveryState.json');
  const calendarClient = { events: { async list() {
    listed++;
    return { data: { timeZone: 'Asia/Kolkata', items: [
      event('Kerala Hack', '29 Sep 2026'), event('Online Hack', '29 Sep 2026', { mode: 'online' })
    ] } };
  } } };
  const transport = { async sendMail(message) { sent.push(message); } };

  assert.deepEqual(await sendDeadlineEmail({ now, calendarClient, env, state: loadState(stateFile, now), transport }), { sent: true, count: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, env.REPORT_EMAIL);
  assert.match(sent[0].text, /Kerala Hack/);
  assert.doesNotMatch(sent[0].text, /Online Hack/);
  assert.equal(loadState(stateFile, now).data.deadlineEmail.lastSentDay, '2026-09-27');
  assert.deepEqual(await sendDeadlineEmail({ now, calendarClient, env, state: loadState(stateFile, now), transport }), { sent: false, count: 0 });
  assert.equal(sent.length, 1);
  assert.equal(listed, 1);
});

test('a day with no eligible events sends nothing and leaves the daily slot available', async () => {
  const state = { data: {}, save() { throw new Error('Should not save'); } };
  const calendarClient = { events: { async list() { return { data: { items: [event('Online', '29 Sep 2026', { mode: 'online' })] } }; } } };
  const transport = { async sendMail() { throw new Error('Should not send'); } };
  assert.deepEqual(await sendDeadlineEmail({ now, calendarClient, env: {}, state, transport }), { sent: false, count: 0 });
  assert.equal(state.data.deadlineEmail, undefined);
});
