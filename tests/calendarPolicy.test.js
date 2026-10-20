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
test('titles carry a colour dot every viewer of a shared calendar sees', () => {
  const titled = h => calendarSummary(h, getEventColorId(h));
  const kerala = titled({ name: 'Devin Hacks Kochi', location: 'Kochi, Kerala', mode: 'offline' });
  const south = titled({ name: 'DevHack 2026', location: 'Mangaluru, Karnataka', mode: 'offline' });
  const online = titled({ name: 'PayPal AI Hackathon', location: 'Online', mode: 'online' });
  assert.equal(kerala, '1 · 🟢 Kerala · Devin Hacks Kochi');
  assert.equal(south, '2 · 🔴 DevHack 2026');
  assert.equal(online, '2 · 🔵 PayPal AI Hackathon');
  // Kerala still sorts first, and old or re-titled names come back unchanged.
  assert.deepEqual([online, south, kerala].sort()[0], kerala);
  for (const t of [kerala, south, online, '1 · Kerala · Devin Hacks Kochi', '2 · DevHack 2026']) {
    assert.equal(titled({ name: t, location: 'Online', mode: 'online' }), `2 · 🔵 ${originalName(t)}`);
  }
  assert.equal(originalName(south), 'DevHack 2026');
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
  assert.equal(patches[0].resource.summary, '1 · 🟢 Kerala · HackAthena');
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

test('a hackathon with the same name and closing date is one hackathon, whatever the wording', () => {
  const { sameName, isSameHackathon } = require('../scraper/utils/normalize');
  for (const [a, b] of [
    ['BUiLDX', 'BUiLDX Hackathon'],
    ['Life After Code', 'GitLab "Life After Code"'],
    ['OpenCV AI Competition 2026, powered by AWS', 'OpenCV AI Competition 2026 (AWS)'],
    ['Odoo x Make a ton', 'Odoo × Make-A-Ton 9.0'],
    ['Make-A-Ton 9.0 (Odoo × CUSAT)', 'Odoo × Make-A-Ton 9.0'],
    ['DevHack 2026 (Sahyadri OSC)', 'DevHack 2026 ']
  ]) assert.equal(sameName(a, b), true, `${a} / ${b}`);
  for (const [a, b] of [['AI Product Hackathon', 'Agentic AI Hackathon'], ['Q Hackathon', 'AI Product Hackathon'],
    ['Hackathon', 'Agentic AI Hackathon'], ['CodersInPune Hackathon - HackWIthPune', 'CodeFrontier Hackathon - Hack With Pune'],
    ['Codex 48 - National-Level Hackathon', 'Code star 30 — National-Level Hackathon']]) {
    assert.equal(sameName(a, b), false, `${a} / ${b}`);
  }
  const devhack = { name: 'DevHack 2026', day: '2026-10-22', link: 'https://unstop.com/hackathons/devhack-1759829' };
  // Same link and day, different name.
  assert.equal(isSameHackathon(devhack, { name: 'DevHost', day: '2026-10-22', link: 'https://unstop.com/hackathons/devhack-1759829?lb=x' }), true);
  // Same name, another day.
  assert.equal(isSameHackathon(devhack, { ...devhack, day: '2026-10-23' }), false);
  // Two listings on one platform stay apart.
  assert.equal(isSameHackathon({ name: 'Avishkaar Season 4', day: '2026-10-25', link: 'https://unstop.com/hackathons/a-1' },
    { name: 'Avishkaar Season 4 (Virtual)', day: '2026-10-25', link: 'https://unstop.com/hackathons/a-2' }), false);
});

test('maintenance removes the extra copy of a hackathon and keeps the platform-linked one', async () => {
  const entry = (id, summary, link) => ({ id, summary, start: { date: '2026-10-22' }, end: { date: '2026-10-23' }, colorId: '11',
    description: `Mode: offline\nLocation: Mangaluru, Karnataka\nLink: ${link}\nRegistration Deadline: 22 Oct 2026\n` });
  const deletes = [];
  const client = { events: {
    async list() { return { data: { items: [
      entry('sheet', '2 · DevHack 2026 (Sahyadri OSC)', 'https://college.example/devhack'),
      entry('unstop', '2 · DevHack 2026', 'https://unstop.com/hackathons/devhack-1759829'),
      entry('other', '2 · Celestia', 'https://unstop.com/hackathons/celestia-1')] } }; },
    async delete(x) { deletes.push(x.eventId); }, async patch() {}
  } };
  const result = await maintainCalendar({ now: new Date('2026-10-20T10:00:00+05:30'), client, calendarId: 'test' });
  assert.deepEqual(deletes, ['sheet']);
  assert.equal(result.deleted, 1);
});

test('maintenance removes entries built from the sheet text instead of the linked page', async () => {
  const deletes = [];
  const client = { events: {
    async list() { return { data: { items: [{ id: 'old-sheet', summary: '2 · Speed Demon 2026 (Hackathon Raptors)',
      start: { date: '2026-10-26' }, end: { date: '2026-10-27' }, colorId: '9', extendedProperties: { private: { managedBy: 'hack-scrapper' } },
      description: 'Mode: online\nLocation: Online\nLink: \nRegistration Deadline: 26 Oct 2026\nPrize: $2,000\n\n' +
        'From the claude tab of https://docs.google.com/spreadsheets/d/x/edit\nLocation in sheet: Online' }] } }; },
    async delete(x) { deletes.push(x.eventId); }, async patch() {}
  } };
  await maintainCalendar({ now: new Date('2026-10-20T10:00:00+05:30'), client, calendarId: 'test' });
  assert.deepEqual(deletes, ['old-sheet']);
});
