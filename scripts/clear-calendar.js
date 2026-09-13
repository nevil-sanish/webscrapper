const { clearAllCalendarEvents } = require('../scraper/utils/calendar');

async function main() {
  console.log('Clearing all events from Google Calendar...');
  const count = await clearAllCalendarEvents();
  console.log(`Finished. Removed ${count} events.`);
}

main().catch(console.error);
