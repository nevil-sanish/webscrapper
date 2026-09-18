const test = require('node:test');
const assert = require('node:assert/strict');
const { createSearchClient } = require('../scraper/search/providers');
const { getRunKeywords, keralaDistricts } = require('../scraper/search/keywordList');
const logger = { warn() {} };
function httpError(status) { return Object.assign(new Error('secret must never be logged'), { response: { status } }); }

test('Tavily supplies URLs with basic search and never calls backup on success', async () => {
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger, http: {
    async post(url, body, config) {
      assert.equal(url, 'https://api.tavily.com/search');
      assert.equal(body.query, 'hackathon Kerala');
      assert.equal(body.search_depth, 'basic');
      assert.equal(body.auto_parameters, false);
      assert.equal(config.headers.Authorization, 'Bearer primary');
      return { data: { results: [{ url: 'https://example.org/event' }, { url: 'https://example.org/event' }, { url: 'broken' }, { url: 'javascript:alert(1)' }] } };
    },
    async get() { assert.fail('backup must not be called'); }
  } });
  assert.deepEqual(await client.search('hackathon Kerala'), { provider: 'tavily', urls: ['https://example.org/event'] });
});

test('empty successful Tavily results preserve backup credits', async () => {
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger, http: {
    async post() { return { data: { results: [] } }; },
    async get() { assert.fail('backup must not be called'); }
  } });
  assert.deepEqual(await client.search('empty'), { provider: 'tavily', urls: [] });
});

test('Tavily quota/auth/rate failures fall back and stop retrying primary this run', async () => {
  for (const status of [401, 403, 429, 432, 433]) {
    let primaryCalls = 0;
    let backupCalls = 0;
    const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger, http: {
      async post() { primaryCalls++; throw httpError(status); },
      async get(url, config) {
        backupCalls++;
        assert.equal(config.params.api_key, 'backup');
        return { data: { organic_results: [{ link: 'https://example.org/backup' }] } };
      }
    } });
    assert.equal((await client.search('one')).provider, 'serpapi');
    assert.equal((await client.search('two')).provider, 'serpapi');
    assert.equal(primaryCalls, 1);
    assert.equal(backupCalls, 2);
  }
});

test('temporary primary failure falls back then retries primary on next query', async () => {
  let calls = 0;
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger, http: {
    async post() { if (++calls === 1) throw httpError(500); return { data: { results: [] } }; },
    async get() { return { data: { organic_results: [] } }; }
  } });
  assert.equal((await client.search('one')).provider, 'serpapi');
  assert.equal((await client.search('two')).provider, 'tavily');
});

test('SerpApi-only configuration works and quota response disables backup', async () => {
  const client = createSearchClient({ tavilyKey: '', serpKey: 'backup', logger, http: {
    async get() { return { data: { error: 'Monthly search limit exceeded' } }; }
  } });
  assert.equal(client.isAvailable(), true);
  assert.deepEqual(await client.search('one'), { provider: null, urls: [] });
  assert.equal(client.isAvailable(), false);
});

test('missing keys skip search; both exhausted providers become unavailable', async () => {
  const empty = createSearchClient({ tavilyKey: '', serpKey: '', logger, http: {} });
  assert.equal(empty.isAvailable(), false);
  assert.deepEqual(await empty.search('one'), { provider: null, urls: [] });
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger, http: {
    async post() { throw httpError(432); }, async get() { throw httpError(429); }
  } });
  assert.deepEqual(await client.search('one'), { provider: null, urls: [] });
  assert.equal(client.isAvailable(), false);
});

test('malformed provider response falls back and logs omit sensitive error details', async () => {
  const messages = [];
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger: { warn: x => messages.push(x) }, http: {
    async post() { return { data: {} }; },
    async get() { throw httpError(500); }
  } });
  assert.equal((await client.search('one')).provider, null);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(m => !m.includes('secret')));
});

test('20-query schedule always covers 14 Kerala districts and rotates extras', () => {
  const a = getRunKeywords(new Date('2026-09-18T00:00:00Z'));
  const b = getRunKeywords(new Date('2026-09-20T00:00:00Z'));
  assert.equal(a.length, 20);
  assert.equal(new Set(a).size, 20);
  assert.equal(a.filter(q => q.includes('Kerala')).length, 18);
  for (const d of keralaDistricts) assert.ok(a.some(q => q.includes(`${d} Kerala`)));
  assert.notDeepEqual(a.slice(14, 16), b.slice(14, 16));
});

test('local primary budget exhaustion routes directly to backup without a request', async () => {
  const client = createSearchClient({ tavilyKey: 'primary', serpKey: 'backup', logger,
    reserve: provider => provider === 'serpapi', http: {
      async post() { assert.fail('primary budget exhausted'); },
      async get() { return { data: { organic_results: [] } }; }
    }
  });
  assert.equal((await client.search('Kerala hackathon')).provider, 'serpapi');
});
