const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeDevpost, parseDevpostListing, isTopCompany } = require('../scraper/sites/devpost');
const { getEventColorId } = require('../scraper/utils/calendar');

const now = new Date('2026-09-28T10:00:00+05:30');
function card(title, location, prize = '$<span data-currency-value>1,250</span>', extra = {}) {
  return {
    title, url: `https://${title.toLowerCase().replace(/\W+/g, '-')}.devpost.com/`,
    displayed_location: { icon: location === 'Online' ? 'globe' : 'map-marker-alt', location },
    time_left_to_submission: '3 days left',
    submission_period_dates: 'Sep 20 - Oct 01, 2026',
    prize_amount: prize, prizes_counts: { cash: 1, other: 0 },
    open_state: 'open', ...extra
  };
}

test('Devpost cards become deadline reminders with the existing location colors', () => {
  const examples = [
    [card('Kottayam Hack', 'Kottayam, Kerala'), 'offline', '2026-10-01', '10'],
    [card('Chennai Hack', 'Chennai, Tamil Nadu'), 'offline', '2026-10-01', '11'],
    [card('Bengaluru Hack', 'Bengaluru, Karnataka'), 'offline', '2026-10-01', '11'],
    [card('Online Hack', 'Online'), 'online', '2026-10-01', '9']
  ];
  for (const [listing, mode, deadline, color] of examples) {
    const result = parseDevpostListing(listing, now);
    assert.equal(result.mode, mode);
    assert.equal(result.registrationDeadline, deadline);
    assert.equal(result.location, listing.displayed_location.location);
    assert.equal(result.prize, '$1,250');
    assert.equal(result.prizeUsd, 1250);
    assert.equal(getEventColorId(result), color);
  }
});

test('Devpost keeps online with no cash (unranked), and excludes outside venues and listings with no usable deadline', () => {
  const noCash = parseDevpostListing(card('No Prize', 'Online', '$<span data-currency-value>0</span>'), now);
  assert.equal(noCash.prize, null);
  assert.equal(noCash.prizeUsd, 0);
  assert.equal(parseDevpostListing(card('Other Prize', 'Online', '$1,250', { prizes_counts: { cash: 0, other: 3 } }), now).prize, null);
  // Offline in the south is kept with no prize at all.
  for (const place of ['Kochi, Kerala', 'Chennai, Tamil Nadu', 'Bengaluru, Karnataka']) {
    const free = parseDevpostListing(card(`Free ${place}`, place, '$<span data-currency-value>0</span>', { prizes_counts: { cash: 0, other: 0 } }), now);
    assert.equal(free.mode, 'offline');
    assert.equal(free.prize, null);
  }
  assert.equal(parseDevpostListing(card('Delhi Hack', 'Delhi, India'), now), null);
  assert.equal(parseDevpostListing(card('Unknown Venue', 'Amy Gutman Hall'), now), null);
  assert.equal(parseDevpostListing(card('No Date', 'Online', '$1,250', {
    time_left_to_submission: 'date TBA', submission_period_dates: ''
  }), now), null);
});

test('Devpost uses the displayed end date when the days-left label is approximate', () => {
  const result = parseDevpostListing(card('Long Hack', 'Online', '$1,250', {
    time_left_to_submission: 'about 1 month left',
    submission_period_dates: 'Jul 15 - Oct 31, 2026'
  }), now);
  assert.equal(result.registrationDeadline, '2026-10-31');
});

test('Devpost requests every page reported by total count, including after a short and empty page', async () => {
  const requestedPages = [];
  const client = { async get(url) {
    const page = Number(new URL(url).searchParams.get('page'));
    requestedPages.push(page);
    return { data: { meta: { total_count: 19, per_page: 9 }, hackathons:
      page === 1 ? [card('First Hack', 'Online')] :
      page === 2 ? [] : [card('Last Hack', 'Kottayam, Kerala')]
    } };
  } };
  const results = await scrapeDevpost({ client, now });
  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.deepEqual(results.map(h => h.name), ['First Hack', 'Last Hack']);
});

test('Devpost keeps the top 20 prize pools plus top companies further down', async () => {
  const listings = Array.from({ length: 25 }, (_, i) => card(`Hack ${i}`, 'Online', `$${(i + 1) * 1000}`));
  listings.push(card('Small Google Hack', 'Online', '$100', { organization_name: 'Google' }));
  listings.push(card('Rupee Hack', 'Online', '₹30,000'));
  listings.push(card('Tiny Kochi Hack', 'Kochi, Kerala', '$0', { prizes_counts: { cash: 0, other: 0 } }));
  const client = { async get() { return { data: { meta: { total_count: listings.length, per_page: 50 }, hackathons: listings } }; } };
  const results = await scrapeDevpost({ client, now });
  assert.equal(results.length, 22);
  assert.ok(results.some(h => h.name === 'Tiny Kochi Hack'));
  assert.equal(results[0].name, 'Hack 24');
  assert.equal(results[19].name, 'Hack 5');
  assert.ok(results.slice(20).some(h => h.name === 'Small Google Hack'));
  assert.ok(results.stats.skippedItems.some(s => s.name === 'Rupee Hack'));
});

test('Top company match is on whole words', () => {
  assert.ok(isTopCompany('Amazon Web Services'));
  assert.ok(isTopCompany('AWS'));
  assert.ok(!isTopCompany('Metamorph Labs'));
  assert.ok(!isTopCompany(null));
});
