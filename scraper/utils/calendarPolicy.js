const { keralaPriority } = require('./eventPolicy');
function originalName(name = '') { return name.replace(/^[12] · (?:Kerala · )?/, ''); }
function calendarSummary(event) { return `${keralaPriority(event) ? '1 · Kerala · ' : '2 · '}${originalName(event.name)}`; }
function isManaged(event) {
  return event.extendedProperties?.private?.managedBy === 'hack-scrapper' ||
    (/^Mode:/m.test(event.description || '') && /^Link:\s*https?:\/\//m.test(event.description || ''));
}
function localDay(date, timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
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
module.exports = { originalName, calendarSummary, isManaged, isPastEvent, fromCalendar };
