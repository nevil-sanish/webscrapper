const { keralaPriority } = require('./eventPolicy');
const { parseDateToYMD } = require('./pageParser');
function originalName(name = '') { return name.replace(/^[12] · (?:Kerala · )?/, ''); }
function calendarSummary(event) { return `${keralaPriority(event) ? '1 · Kerala · ' : '2 · '}${originalName(event.name)}`; }
function isManaged(event) {
  return event.extendedProperties?.private?.managedBy === 'hack-scrapper' ||
    (/^Mode:/m.test(event.description || '') && /^Link:\s*https?:\/\//m.test(event.description || ''));
}
function localDay(date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function registrationDeadlineDay(event, timeZone = 'Asia/Kolkata') {
  const described = (event.description || '').match(/^Registration Deadline:[ \t]*(.+)$/mi)?.[1];
  const parsed = described && parseDateToYMD(described);
  if (parsed) return parsed;
  // Older scraper entries started on the registration deadline but may not
  // have included a Registration Deadline line in their description.
  if (event.start?.date) return event.start.date;
  if (event.start?.dateTime) {
    const start = new Date(event.start.dateTime);
    if (!isNaN(start.getTime())) return localDay(start, timeZone);
  }
  return null;
}
function isRegistrationClosed(event, now = new Date(), timeZone = 'Asia/Kolkata') {
  if (!isManaged(event) || event.recurrence || event.recurringEventId) return false;
  const deadline = registrationDeadlineDay(event, timeZone);
  return Boolean(deadline && deadline < localDay(now, timeZone));
}
function isPastEvent(event, now = new Date(), timeZone = 'Asia/Kolkata') {
  if (!isManaged(event) || event.recurrence || event.recurringEventId) return false;
  const today = localDay(now, timeZone);
  // All-day end dates are exclusive: yesterday's event ends at today's midnight.
  if (event.end?.date) return event.end.date <= today;
  if (event.end?.dateTime) {
    const end = new Date(event.end.dateTime);
    return !isNaN(end) && localDay(new Date(end.getTime() - 1), timeZone) < today;
  }
  return false;
}
function fromCalendar(event) {
  const description = event.description || '';
  return { name: originalName(event.summary || ''), description,
    mode: description.match(/^Mode:[ \t]*(.*)$/m)?.[1]?.trim() || '',
    location: description.match(/^Location:[ \t]*(.*)$/m)?.[1]?.trim() || event.location || '' };
}
module.exports = { originalName, calendarSummary, isManaged, registrationDeadlineDay, isRegistrationClosed, isPastEvent, fromCalendar, localDay };
