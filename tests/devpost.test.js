const test = require('node:test');
const assert = require('node:assert/strict');
const { scrapeDevpost, parseDevpostListing } = require('../scraper/sites/devpost');
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
    assert.equal(getEventColorId(result), color);
  }
});

test('Devpost excludes no cash, outside venues, and listings with no usable deadline', () => {
  assert.equal(parseDevpostListing(card('No Prize', 'Online', '$<span data-currency-value>0</span>'), now), null);
  assert.equal(parseDevpostListing(card('Other Prize', 'Online', '$1,250', { prizes_counts: { cash: 0, other: 3 } }), now), null);
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
