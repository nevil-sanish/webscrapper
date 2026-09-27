const nodemailer = require('nodemailer');
const { classifyAttendance, keralaPriority, shouldKeepHackathon } = require('./eventPolicy');
const { isManaged, registrationDeadlineDay, fromCalendar, localDay } = require('./calendarPolicy');
const { getCalendarClient } = require('./calendar');
const { loadState } = require('../search/state');

function addDays(day, count) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

function matchingDeadlines(items, now = new Date(), timeZone = 'Asia/Kolkata') {
  const today = localDay(now, timeZone);
  const lastDay = addDays(today, 3);
  const matches = new Map();

  for (const item of items) {
    if (!isManaged(item) || item.recurrence || item.recurringEventId) continue;
    const deadline = registrationDeadlineDay(item, timeZone);
    if (!deadline || deadline < today || deadline > lastDay) continue;

    const hackathon = classifyAttendance(fromCalendar(item));
    if (hackathon.mode !== 'offline' || !keralaPriority(hackathon) || !shouldKeepHackathon(hackathon)) continue;

    const name = hackathon.name.trim();
    const key = `${name.toLowerCase()}|${deadline}`;
    if (!name || matches.has(key)) continue;
    const url = item.description?.match(/^Link:[ \t]*(https?:\/\/\S+)/mi)?.[1] || '';
    matches.set(key, { name, deadline, location: hackathon.location, url });
  }

  return [...matches.values()].sort((a, b) => a.deadline.localeCompare(b.deadline) || a.name.localeCompare(b.name));
}

async function sendDeadlineEmail({
  now = new Date(),
  calendarClient = getCalendarClient(),
  env = process.env,
  state = loadState(undefined, now),
  transport
} = {}) {
  const today = localDay(now);
  if (state.data.deadlineEmail?.lastSentDay === today) {
    console.log('Deadline email already sent today; skipping.');
    return { sent: false, count: 0 };
  }
  if (!calendarClient) throw new Error('Google Calendar is required for deadline email');

  const items = [];
  let pageToken;
  let timeZone = 'Asia/Kolkata';
  do {
    const res = await calendarClient.events.list({
      calendarId: env.GOOGLE_CALENDAR_ID || 'primary', maxResults: 2500, pageToken, showDeleted: false
    });
    items.push(...(res.data.items || []));
    timeZone = res.data.timeZone || timeZone;
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  const events = matchingDeadlines(items, now, timeZone);
  if (!events.length) {
    console.log('No offline Kerala registration deadlines within three days; no email sent.');
    return { sent: false, count: 0 };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, REPORT_EMAIL } = env;
  const port = Number(SMTP_PORT);
  if (!SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !SMTP_USER || !SMTP_PASS || !REPORT_EMAIL) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and REPORT_EMAIL are required for deadline email');
  }

  const mailer = transport || nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  const lines = events.flatMap(event => [
    event.name,
    `Registration deadline: ${event.deadline}`,
    `Location: ${event.location}`,
    ...(event.url ? [`Link: ${event.url}`] : []),
    ''
  ]);
  await mailer.sendMail({
    from: SMTP_USER,
    to: REPORT_EMAIL,
    subject: `Kerala offline hackathon deadlines within 3 days (${events.length})`,
    text: lines.join('\n').trim()
  });

  state.data.deadlineEmail = { lastSentDay: today };
  state.save();
  console.log(`Deadline email sent with ${events.length} offline Kerala hackathon(s).`);
  return { sent: true, count: events.length };
}

module.exports = { matchingDeadlines, sendDeadlineEmail };
