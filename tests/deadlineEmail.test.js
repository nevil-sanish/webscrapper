const test = require('node:test');
const assert = require('node:assert/strict');
const { upcomingDeadlines, keralaClosingTomorrow, sendDeadlineEmail } = require('../scraper/utils/deadlineEmail');

const now = new Date('2026-09-27T01:30:00Z'); // 07:00 IST
const env = {
  SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', SMTP_USER: 'sender@example.org',
  SMTP_PASS: 'test-password', REPORT_EMAIL: 'recipient@example.org'
};

function event(name, deadline, { mode = 'offline', location = 'Kochi, Kerala', prize = '₹50,000', managed = true } = {}) {
  return {
    id: name,
    summary: name,
    description: managed ? `Mode: ${mode}\nLocation: ${location}\nLink: https://example.org/${name}\nRegistration Deadline: ${deadline}\nPrize: ${prize}` : 'Personal appointment',
    start: { date: '2026-09-27' },
    end: { date: '2026-10-05' }
  };
}

test('the daily digest lists every calendar hackathon closing today through day three', () => {
  const items = [
    event('Today Kochi', '27 Sep 2026'),
    event('Day three online', '30 Sep 2026', { mode: 'online', location: 'Online' }),
    event('Chennai', '28 Sep 2026', { location: 'Chennai, Tamil Nadu' }),
    event('Too late', '01 Oct 2026'),
    event('Closed', '26 Sep 2026'),
    event('Outside state', '28 Sep 2026', { location: 'Pune, Maharashtra' }),
    event('Online no prize', '28 Sep 2026', { mode: 'online', location: 'Online', prize: 'Certificates' }),
    event('Private', '28 Sep 2026', { managed: false }),
    { ...event('Recurring', '28 Sep 2026'), recurrence: ['RRULE:FREQ=DAILY'] },
    event('Today Kochi', '27 Sep 2026')
  ];
  const events = upcomingDeadlines(items, now);
  assert.deepEqual(events.map(x => `${x.dot} ${x.name}`), ['🟢 Today Kochi', '🔴 Chennai', '🟣 Online no prize', '🔵 Day three online']);
  // Late on the 27th in India is already the 28th.
  assert.deepEqual(upcomingDeadlines(items, new Date('2026-09-27T20:00:00Z')).map(x => x.name), ['Chennai', 'Online no prize', 'Day three online', 'Too late']);
});

test('the last-day alert is only offline Kerala hackathons closing tomorrow', () => {
  const items = [
    event('Kochi tomorrow', '28 Sep 2026'),
    event('Hybrid Thrissur tomorrow', '28 Sep 2026', { mode: 'hybrid', location: 'Thrissur, Kerala' }),
    event('Kochi today', '27 Sep 2026'),
    event('Kochi in two days', '29 Sep 2026'),
    event('Chennai tomorrow', '28 Sep 2026', { location: 'Chennai, Tamil Nadu' }),
    event('Online tomorrow', '28 Sep 2026', { mode: 'online', location: 'Online' })
  ];
  assert.deepEqual(keralaClosingTomorrow(items, now).map(x => x.name), ['Hybrid Thrissur tomorrow', 'Kochi tomorrow']);
});

test('every run sends the digest and the Kerala alert, even a second run the same day', async () => {
  const sent = [];
  const calendarClient = { events: { async list() {
    return { data: { items: [
      event('Kerala Hack', '28 Sep 2026'), event('Online Hack', '29 Sep 2026', { mode: 'online', location: 'Online', prize: '$5,000' })
    ] } };
  } } };
  const transport = { async sendMail(message) { sent.push(message); } };

  const first = await sendDeadlineEmail({ now, calendarClient, env, transport });
  assert.deepEqual(first, { digest: 2, keralaTomorrow: 1, sent: ['keralaTomorrow', 'digest'] });
  assert.equal(sent.length, 2);
  assert.match(sent[0].subject, /Tomorrow is the last day: Kerala Hack/);
  assert.match(sent[0].text, /closes tomorrow, 28 Sep 2026/);
  assert.doesNotMatch(sent[0].text, /Online Hack/);
  assert.match(sent[1].subject, /next 3 days \(2\)/);
  assert.match(sent[1].text, /Tomorrow - 28 Sep 2026[\s\S]*🟢 Kerala Hack[\s\S]*In 2 days - 29 Sep 2026[\s\S]*🔵 Online Hack/);
  assert.equal(sent.every(m => m.to === env.REPORT_EMAIL), true);

  const again = await sendDeadlineEmail({ now, calendarClient, env, transport });
  assert.deepEqual(again.sent, ['keralaTomorrow', 'digest']);
  assert.equal(sent.length, 4);
});

test('the digest is still sent on a day with nothing closing, and no alert is', async () => {
  const sent = [];
  const calendarClient = { events: { async list() { return { data: { items: [event('Far away', '20 Oct 2026')] } }; } } };
  const result = await sendDeadlineEmail({ now, calendarClient, env, transport: { async sendMail(m) { sent.push(m); } } });
  assert.deepEqual(result.sent, ['digest']);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /No hackathon registrations close between 27 Sep 2026 and 30 Sep 2026/);
  assert.equal(sent.length, 1);
});

test('REPORT_EMAIL can list several people, who all get one email', async () => {
  const sent = [];
  const calendarClient = { events: { async list() { return { data: { items: [] } }; } } };
  const many = { ...env, REPORT_EMAIL: 'a@example.org ,b@example.org, c@example.ac.in,d@example.org ' };
  await sendDeadlineEmail({ now, calendarClient, env: many, transport: { async sendMail(m) { sent.push(m); } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'a@example.org, b@example.org, c@example.ac.in, d@example.org');
  await assert.rejects(sendDeadlineEmail({ now, calendarClient, env: { ...env, REPORT_EMAIL: 'a@example.org, not-an-address' },
    transport: { async sendMail() {} } }), /invalid address: not-an-address/);
});
