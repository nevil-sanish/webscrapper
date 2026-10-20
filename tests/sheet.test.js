const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeSheet } = require('../scraper/sites/sheet');
const { getEventColorId } = require('../scraper/utils/calendar');

const now = new Date('2026-10-19T10:00:00+05:30');
// Column I (index 8) holds the link in both tabs; the Hackathon tab's header there is a stray "`".
const row = (name, link, sheetSays = 'Closing 01/01/2099 · Online · $1,000,000') => [name, sheetSays, '', '01/01/2099', '', '$1,000,000', 'Online', 'No', link];

// What each link's own site answers.
const nextData = hackathon => `<html><body><script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { hackathon } } })}</script></body></html>`;
const pages = {
  'https://unstop.com/api/public/competition/1759829': { data: { competition: {
    title: 'DevHack 2026', region: 'offline', details: '<p>A 36-hour offline hackathon.</p>',
    address_with_country_logo: { city: 'Mangaluru', state: 'Karnataka' },
    regnRequirements: { end_regn_dt: '2026-10-22T23:59:00+05:30' }, payment_services: [{ amount: 250 }],
    prizes: [{ cash: 50000 }, { cash: 30000 }, { cash: 20000 }]
  } } },
  'https://unstop.com/api/public/competition/1766233': { data: { competition: {
    title: 'CASCADE 26 Hackathon', region: 'offline', details: '<p>Offline hackathon.</p>',
    address_with_country_logo: { city: 'Nagpur', state: 'Maharashtra' }, regnRequirements: { end_regn_dt: '2026-10-25T23:59:00+05:30' }
  } } },
  'https://unstop.com/api/public/competition/1770000': { data: { competition: {
    title: 'No Prize Online Hackathon', region: 'online', details: '<p>Online hackathon.</p>',
    regnRequirements: { end_regn_dt: '2026-10-25T23:59:00+05:30' }
  } } },
  'https://devpost.com/api/hackathons?search=paypalaihackathon': { hackathons: [{
    title: 'PayPal AI Hackathon', url: 'https://paypalaihackathon.devpost.com/', time_left_to_submission: '24 days left',
    displayed_location: { icon: 'globe', location: 'Online' }, prize_amount: '$<span data-currency-value>67,500</span>', prizes_counts: { cash: 1 }
  }] },
  'https://haxfinity.devfolio.co': nextData({ name: 'haxfinity', is_online: false,
    location: 'Amal College of Advanced Studies, Nilambur, Myladi, Eranhimangad, Kerala, India',
    settings: { reg_ends_at: '2026-11-10T18:29:00+00:00' }, starts_at: '2026-12-12T05:00:00+00:00', ends_at: '2026-12-13T05:00:00+00:00' }),
  'https://hft2026.devfolio.co': nextData({ name: 'Hack For Tomorrow 2026', is_online: false, settings: { reg_ends_at: '2026-10-18T10:30:00+00:00' } }),
  'https://api.lu.ma/url?url=3v8n74l1': { data: { event: { name: 'Devin Hacks Kochi', start_at: '2026-10-24T11:30:00.000Z',
    end_at: '2026-10-25T05:30:00.000Z', timezone: 'Asia/Kolkata', location_type: 'offline',
    geo_address_info: { full_address: 'Kochi, Kerala, India' } }, ticket_info: { is_free: true } } },
  'https://college.example/hack': '<html><title>Campus Hack</title><body><p>Venue: Coimbatore, Tamil Nadu</p><p>Registration deadline: 30 Oct 2026</p></body></html>'
};
const get = async url => {
  if (!(url in pages)) throw Object.assign(new Error('Forbidden'), { response: { status: 403 } });
  return pages[url];
};

test('each sheet link is read from its own page, with the same filters and colors as the scrapers', async () => {
  const tabs = {
    Hackathon: [['Hackathon', 'Description', 'Date', 'Closing Date', 'Idea', 'Prize Pool', 'Location', 'Registration', '`'],
      row('DevHost', 'https://unstop.com/hackathons/devhack-2026-devhost-2026-sahyadri-open-source-community-1759829'),
      row('PayPal AI', 'https://paypalaihackathon.devpost.com/?ref_feature=challenge'),
      row('Haxfinity', 'https://haxfinity.devfolio.co/overview'),
      row('No link'),
      []],
    claude: [['Hackathon', 'Description', 'Date', 'Closing Date', 'Idea', 'Prize Pool', 'Location', 'Registration', 'Links'],
      // Listed again under another name: added once.
      row('DevHack 2026 (Sahyadri OSC)', 'https://unstop.com/hackathons/devhack-2026-devhost-2026-sahyadri-open-source-community-1759829?lb=x'),
      row('Devin Hacks Kochi', 'https://luma.com/3v8n74l1'),
      row('Campus Hack', 'https://college.example/hack'),
      row('CASCADE', 'https://unstop.com/hackathons/cascade26-1766233'),
      row('No Prize', 'https://unstop.com/hackathons/no-prize-1770000'),
      row('HFT', 'https://hft2026.devfolio.co/'),
      row('SAP', 'https://events.sap.example/home')]
  };
  const results = await scrapeSheet({ read: async tab => tabs[tab], get, now });
  const byName = Object.fromEntries(results.map(h => [h.name, h]));

  // Names, dates, venues and prizes come from the pages, not the sheet.
  assert.deepEqual(Object.keys(byName).sort(), ['Campus Hack', 'DevHack 2026', 'Devin Hacks Kochi', 'PayPal AI Hackathon', 'haxfinity']);
  assert.equal(byName['DevHack 2026'].registrationDeadline, '2026-10-22');
  assert.equal(byName['DevHack 2026'].prize, '₹1,00,000');
  assert.equal(byName['haxfinity'].registrationDeadline, '2026-11-10');
  assert.equal(byName['Devin Hacks Kochi'].registrationDeadline, '2026-10-24');
  assert.equal(byName['Campus Hack'].registrationDeadline, '2026-10-30');

  assert.equal(getEventColorId(byName['haxfinity']), '10');
  assert.equal(getEventColorId(byName['Devin Hacks Kochi']), '10');
  assert.equal(getEventColorId(byName['DevHack 2026']), '11');
  assert.equal(getEventColorId(byName['Campus Hack']), '11');
  assert.equal(getEventColorId(byName['PayPal AI Hackathon']), '9');

  const reasons = Object.fromEntries(results.stats.skippedItems.map(s => [s.name.replace(/ \[.*/, ''), s.reason]));
  assert.match(reasons.CASCADE, /not in Kerala\/Tamil Nadu\/Karnataka/);
  assert.match(reasons['No Prize'], /online without prize money/);
  assert.match(reasons.HFT, /registration closed/);
  assert.match(reasons.SAP, /403/);
  assert.equal(results.stats.complete, true);
});
