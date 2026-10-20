const nodemailer = require('nodemailer');
const { classifyAttendance, keralaPriority, shouldKeepHackathon } = require('./eventPolicy');
const { isManaged, registrationDeadlineDay, fromCalendar, localDay, DOTS } = require('./calendarPolicy');
const { getCalendarClient, getEventColorId, formatDay } = require('./calendar');
const { loadState } = require('../search/state');

const DAYS_AHEAD = 3;
// The emails go out at 09:00 India time.
const SEND_AT = { hour: 9, minute: 0 };

/**
 * How long to wait before the day's emails may go out: 0 once 09:00 IST has
 * passed, otherwise the milliseconds left until then.
 */
function msUntilSendTime(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60000); // IST is UTC+5:30, no daylight saving
  const sendAt = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), SEND_AT.hour, SEND_AT.minute) - 330 * 60000;
  return Math.max(0, sendAt - now.getTime());
}

function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/**
 * Every scraper hackathon in the calendar whose registration closes today
 * through DAYS_AHEAD days from now, soonest first.
 */
function upcomingDeadlines(items, now = new Date(), timeZone = 'Asia/Kolkata') {
  const today = localDay(now, timeZone);
  const lastDay = addDays(today, DAYS_AHEAD);
  const matches = new Map();

  for (const item of items) {
    if (!isManaged(item) || item.recurrence || item.recurringEventId) continue;
    const deadline = registrationDeadlineDay(item, timeZone);
    if (!deadline || deadline < today || deadline > lastDay) continue;

    const hackathon = classifyAttendance(fromCalendar(item));
    if (!shouldKeepHackathon(hackathon)) continue;

    const name = hackathon.name.trim();
    const key = `${name.toLowerCase()}|${deadline}`;
    if (!name || matches.has(key)) continue;
    matches.set(key, {
      name,
      deadline,
      mode: hackathon.mode,
      location: hackathon.location,
      prize: hackathon.prize,
      kerala: Boolean(keralaPriority(hackathon)),
      dot: DOTS[getEventColorId(hackathon)] || '',
      url: item.description?.match(/^Link:[ \t]*(https?:\/\/\S+)/mi)?.[1] || ''
    });
  }

  return [...matches.values()].sort((a, b) => a.deadline.localeCompare(b.deadline) ||
    Number(b.kerala) - Number(a.kerala) || a.name.localeCompare(b.name));
}

// Offline Kerala hackathons whose registration closes tomorrow: the last full
// day to register.
function keralaClosingTomorrow(items, now = new Date(), timeZone = 'Asia/Kolkata') {
  const tomorrow = addDays(localDay(now, timeZone), 1);
  return upcomingDeadlines(items, now, timeZone).filter(e => e.deadline === tomorrow && e.kerala && e.mode === 'offline');
}

function dayLabel(day, today) {
  const offset = Math.round((new Date(`${day}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  const prefix = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `In ${offset} days`;
  return `${prefix} - ${formatDay(day)}`;
}

function eventLines(event) {
  return [
    `${event.dot ? `${event.dot} ` : ''}${event.name}`,
    `   ${event.mode === 'online' ? 'Online' : event.location}${event.prize ? ` · Prize: ${event.prize}` : ''}`,
    ...(event.url ? [`   ${event.url}`] : [])
  ];
}

function digestText(events, today) {
  if (!events.length) return `No hackathon registrations close between ${formatDay(today)} and ${formatDay(addDays(today, DAYS_AHEAD))}.`;
  const lines = [];
  for (const day of [...new Set(events.map(e => e.deadline))]) {
    lines.push(`${dayLabel(day, today)}`, '');
    for (const event of events.filter(e => e.deadline === day)) lines.push(...eventLines(event), '');
  }
  lines.push('🟢 Kerala offline · 🔴 Tamil Nadu / Karnataka offline · 🔵 online, free, prize money · 🟣 online, no prize money or paid entry');
  return lines.join('\n').trim();
}

async function listCalendar(calendarClient, calendarId) {
  const items = [];
  let pageToken;
  do {
    const res = await calendarClient.events.list({ calendarId, maxResults: 2500, pageToken, showDeleted: false });
    items.push(...(res.data.items || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

function mailerFor(env, transport) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL } = env;
  const port = Number(SMTP_PORT);
  // REPORT_EMAIL may list several people, comma separated: they all get the same single email.
  const to = String(REPORT_EMAIL || '').split(',').map(a => a.trim()).filter(Boolean);
  if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !SMTP_USER || !SMTP_PASS || !to.length) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and REPORT_EMAIL are required for deadline email');
  }
  const bad = to.filter(a => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  if (bad.length) throw new Error(`REPORT_EMAIL has an invalid address: ${bad.join(', ')}`);
  const mailer = transport || nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return message => mailer.sendMail({ from: SMTP_USER, to: to.join(', '), ...message });
}

/**
 * Sends, at most once per day each:
 * 1. a digest of every hackathon whose registration closes today through three days out;
 * 2. an alert for offline Kerala hackathons whose registration closes tomorrow.
 * The day a mail was sent is saved, so a second run that day sends nothing again.
 */
async function sendDeadlineEmail({
  now = new Date(),
  calendarClient = getCalendarClient(),
  env = process.env,
  state = loadState(undefined, now),
  transport
} = {}) {
  const timeZone = 'Asia/Kolkata';
  const today = localDay(now, timeZone);
  const sentDigest = state.data.deadlineEmail?.lastSentDay === today;
  const sentAlert = state.data.keralaLastDayEmail?.lastSentDay === today;
  const result = { digest: 0, keralaTomorrow: 0, sent: [] };
  if (sentDigest && sentAlert) {
    console.log('Deadline emails already sent today; skipping.');
    return result;
  }
  if (!calendarClient) throw new Error('Google Calendar is required for deadline email');

  const items = await listCalendar(calendarClient, env.GOOGLE_CALENDAR_ID || 'primary');
  const send = mailerFor(env, transport);

  if (!sentAlert) {
    const tomorrow = keralaClosingTomorrow(items, now, timeZone);
    result.keralaTomorrow = tomorrow.length;
    if (tomorrow.length) {
      await send({
        subject: `Tomorrow is the last day: ${tomorrow.map(e => e.name).join(', ')}`,
        text: [`Registration for ${tomorrow.length === 1 ? 'this offline Kerala hackathon' : 'these offline Kerala hackathons'} closes tomorrow, ${formatDay(tomorrow[0].deadline)}.`, '',
          ...tomorrow.flatMap(e => [...eventLines(e), ''])].join('\n').trim()
      });
      state.data.keralaLastDayEmail = { lastSentDay: today };
      state.save();
      result.sent.push('keralaTomorrow');
      console.log(`Kerala last-day email sent for ${tomorrow.length} hackathon(s).`);
    } else {
      console.log('No offline Kerala registration closes tomorrow; no alert sent.');
    }
  }

  if (!sentDigest) {
    const events = upcomingDeadlines(items, now, timeZone);
    result.digest = events.length;
    await send({
      subject: `Hackathons closing in the next ${DAYS_AHEAD} days (${events.length}) - ${formatDay(today)}`,
      text: digestText(events, today)
    });
    state.data.deadlineEmail = { lastSentDay: today };
    state.save();
    result.sent.push('digest');
    console.log(`Daily deadline email sent with ${events.length} hackathon(s).`);
  }
  return result;
}

module.exports = { upcomingDeadlines, keralaClosingTomorrow, digestText, sendDeadlineEmail, msUntilSendTime };
