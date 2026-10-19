const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeSheet, parseSheetRow } = require('../scraper/sites/sheet');
const { getEventColorId } = require('../scraper/utils/calendar');

const now = new Date('2026-10-19T10:00:00+05:30');
const headers = ['Hackathon', 'Description', 'Date', 'Closing Date', 'Idea', 'Prize Pool', 'Location', 'Registration', 'Links', 'Reason'];
const row = (name, closing, prize, location, links = '') => [name, '', '', closing, '', prize, location, 'No', links];

test('sheet rows use the closing date and the Kerala green / south red / online blue colors', () => {
  const cases = [
    [row('Make-A-Ton', '25/10/2026', '₹1,05,000', '8-hr online round → 24-hr final at CUSAT Kochi', 'https://makeaton.in'), 'offline', '10'],
    [row('DevHack', '22/10/2026', '₹1,00,000', 'Online PPT round → 36-hr offline in Mangaluru'), 'offline', '11'],
    [row('BuildX', '01/11/2026', '₹90,000', 'Offline · Vandalur, Chennai'), 'offline', '11'],
    [row('PayPal AI', '13/11/2026', '$67,500 cash', 'Fully online, global', 'https://paypalaihackathon.devpost.com'), 'online', '9'],
    [row('Odoo', '25/10/2026', '105000', 'online then in qualifying at kochi'), 'offline', '10']
  ];
  for (const [r, mode, color] of cases) {
    const event = parseSheetRow(r, headers, 'claude', now);
    assert.equal(event.mode, mode, r[0]);
    assert.equal(getEventColorId(event), color, r[0]);
    assert.equal(event.registrationDeadline, `2026-${r[3].slice(3, 5)}-${r[3].slice(0, 2)}`);
  }
  assert.equal(parseSheetRow(cases[0][0], headers, 'claude', now).sourceUrl, 'https://makeaton.in');
  // Offline in the south never needs prize money.
  for (const [prize, place] of [['', 'Kothamangalam'], ['Not listed', 'Offline · Finale NHCE Bengaluru'], ['Prizes for top 3', 'Offline · Coimbatore']]) {
    assert.equal(parseSheetRow(row('Free', '30/10/2026', prize, place), headers, 'x', now).mode, 'offline', place);
  }
});

test('sheet rows without a future closing date, prize money online, or a southern venue are left out', () => {
  assert.match(parseSheetRow(row('No Date', '', '$3,000', 'Online'), headers, 'x', now), /no closing date/);
  assert.match(parseSheetRow(row('Old', '17/09/2026', '$3,000', 'Online'), headers, 'x', now), /passed/);
  assert.match(parseSheetRow(row('hackCBS', '31/10/2026', 'Prizes for top 3', 'Online'), headers, 'x', now), /without prize/);
  assert.match(parseSheetRow(row('Noida', '21/10/2026', '₹1,00,000', 'Offline · IIIT Nagpur'), headers, 'x', now), /outside/);
  assert.match(parseSheetRow(row('Blank', '21/10/2026', '₹1,00,000', ''), headers, 'x', now), /no location/);
});

test('both tabs are read and a hackathon listed twice is added once', async () => {
  const tabs = {
    Hackathon: [headers, row('PayPal AI Hackathon', '13/11/2026', '$67,500', 'Online', 'https://paypalaihackathon.devpost.com'), []],
    claude: [headers, row('PayPal AI Hackathon', '13/11/2026', '$67,500', 'Online · Devpost', 'https://paypalaihackathon.devpost.com'),
      row('Devin Hacks Kochi', '24/10/2026', 'PS5 + Devin Max plans', 'Offline · Kochi')]
  };
  const results = await scrapeSheet({ read: async tab => tabs[tab], now });
  assert.deepEqual(results.map(h => h.name), ['PayPal AI Hackathon', 'Devin Hacks Kochi']);
  assert.equal(results.stats.complete, true);
});
