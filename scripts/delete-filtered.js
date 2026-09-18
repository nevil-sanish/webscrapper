const { maintainCalendar } = require('../scraper/utils/calendar');
maintainCalendar().catch(error => { console.error(error.message); process.exitCode = 1; });
