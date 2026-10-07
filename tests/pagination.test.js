const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { scrapeUnstop } = require('../scraper/sites/unstop');
const { scrapeDevfolio } = require('../scraper/sites/devfolio');

test('Unstop visits every reported page even when an earlier page is short', async () => {
  const originalGet = axios.get;
  const pages = [];
  axios.get = async url => {
    if (url.includes('search-result')) {
      const page = Number(new URL(url).searchParams.get('page'));
      pages.push(page);
      return { data: { data: { last_page: 3, data: page === 1
        ? [{ id: 1, title: 'Other hackathon' }]
        : page === 3 ? [{ id: 1761959, title: 'Techashy 2.0 Hackathon 2026' }] : [] } } };
    }
    if (url.endsWith('/1')) return { data: { data: {} } };
    if (url.endsWith('/1761959')) return { data: { data: { competition: {
      title: 'Techashy 2.0 Hackathon 2026',
      region: 'offline',
      address_with_country_logo: { city: 'Kottayam', state: 'Kerala' },
      regnRequirements: { end_regn_dt: '2030-10-03T23:59:00+05:30' }
    } } } };
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const results = await scrapeUnstop();
    assert.deepEqual(pages, [1, 2, 3]);
    assert.deepEqual(results.map(h => h.name), ['Techashy 2.0 Hackathon 2026']);
  } finally {
    axios.get = originalGet;
  }
});

test('Devfolio visits every page implied by total even when earlier pages are short', async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  const offsets = [];
  axios.post = async (url, body) => {
    offsets.push(body.from);
    const name = `Hackathon ${body.from}`;
    return { data: { hits: { total: { value: 61 }, hits: body.from === 30 ? [] : [{ _source: {
      name, slug: `hackathon-${body.from}`,
      hackathon_setting: { reg_ends_at: '2030-10-03T23:59:00+05:30' },
      is_online: true
    } }] } } };
  };
  axios.get = async () => ({ data: '<html><body>Applications are open</body></html>' });
  try {
    const results = await scrapeDevfolio();
    assert.deepEqual(offsets, [0, 30, 60]);
    assert.equal(results.length, 2);
  } finally {
    axios.post = originalPost;
    axios.get = originalGet;
  }
});
