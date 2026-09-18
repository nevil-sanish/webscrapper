const axios = require('axios');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { createSearchClient } = require('./providers');
const { getDiscoveryPlan } = require('./keywordList');
const { loadState } = require('./state');
const seeds = require('./sources');
const { canonicalUrl, isSocial, scoreCandidate, pageKind, needsBrowser, eventLinks, namedQuery } = require('./candidates');
const { parseExactHackathonPage } = require('../utils/pageParser');
const { shouldKeepHackathon, keralaPriority } = require('../utils/eventPolicy');
const { isHackathon } = require('../utils/hackathonType');
require('dotenv').config();
const positiveLimit = (value, fallback) => Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;

async function discoverViaSearch(options = {}) {
  const now = options.now || new Date();
  const state = loadState(options.stateFile, now);
  const report = { startedAt: now.toISOString(), queries: [], pages: [], accepted: [], rejectedCandidates: 0 };
  const budget = positiveLimit(options.queryLimit ?? process.env.SEARCH_QUERIES_PER_RUN, 20);
  const pageLimit = positiveLimit(options.pageLimit ?? process.env.SEARCH_PAGES_PER_RUN, 80);
  const limits = { tavily: positiveLimit(process.env.TAVILY_MONTHLY_LIMIT, 900), serpapi: positiveLimit(process.env.SERP_MONTHLY_LIMIT, 80) };
  const client = options.client || createSearchClient({ includeMetadata: true, reserve: provider => state.reserve(provider, limits[provider]) });
  const candidates = new Map();
  const named = new Set();
  function add(item, trusted = false) {
    const url = canonicalUrl(item.url);
    if (!url) {
      // Posters can provide a named-event lead without downloading a PDF as HTML.
      if (/^https?:\/\//.test(item.url || '') && /\.pdf(?:$|[?#])/i.test(item.url)) {
        const q = namedQuery(item, now.getFullYear());
        if (q) named.add(q);
      }
      return;
    }
    const entry = { ...item, url, depth: item.depth || 0 };
    entry.score = scoreCandidate(entry, now);
    // Require an event clue, not merely a place name or the word registration.
    if (!trusted && (!/hackathon|hack[a-z]+|buildathon/i.test(`${entry.title || ''} ${entry.snippet || ''} ${url}`) || entry.score < 5)) {
      report.rejectedCandidates++;
      return;
    }
    if (!trusted && entry.score >= 8) {
      const query = namedQuery(entry, now.getFullYear());
      if (query) named.add(query);
    }
    // Social search snippets can supply event names, but do not become calendar events.
    if (isSocial(url)) return;
    if (options.platformsCovered && /(^|\.)(unstop\.com|devfolio\.co)$/.test(new URL(url).hostname)) return;
    const existing = candidates.get(url);
    if (!existing || entry.score > existing.score) candidates.set(url, entry);
  }
  for (const seed of options.seeds || seeds) add({ ...seed, origin: 'seed' }, true);
  for (const [url, page] of Object.entries(state.data.pages)) {
    if (now.getTime() - page.seenAt < 90 * 86400000 && (!page.deadline || page.deadline >= now.toISOString().slice(0, 10))) {
      add({ url, title: page.title, origin: 'remembered' }, true);
    }
  }
  let queryCount = 0;
  async function query(q) {
    if (queryCount >= budget) return;
    queryCount++;
    const cached = state.cached(q);
    if (!cached && !client.isAvailable()) return;
    const result = cached || await client.search(q);
    if (!cached && result.provider) state.remember(q, result);
    report.queries.push({ query: q, provider: result.provider, cached: Boolean(cached), results: result.urls.length });
    for (const item of result.results || result.urls.map(url => ({ url }))) add({ ...item, origin: q });
  }
  const plan = getDiscoveryPlan(now);
  for (const q of options.queries || plan.initial) await query(q);
  // Target event names found in announcements instead of spending every query on broad terms.
  for (const q of [...named, ...plan.followupFallback]) {
    if (queryCount >= budget) break;
    await query(q);
  }
  console.log(`Discovery: ${report.queries.length} queries (${report.queries.filter(q => q.cached).length} cached), ${candidates.size} relevant URLs; ${report.rejectedCandidates} irrelevant candidates skipped.`);
  const events = [];
  const visited = new Set();
  const perHost = new Map();
  let browserPromise;
  const userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
  async function rendered(url) {
    browserPromise ||= chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
    const browser = await browserPromise;
    const page = await browser.newPage({ userAgent });
    try {
      await page.route('**/*', route => ['image', 'media', 'font'].includes(route.request().resourceType()) ? route.abort() : route.continue());
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForFunction(() => document.body.innerText.trim().length > 200, { }, { timeout: 6000 }).catch(() => {});
      return await page.content();
    } finally { await page.close(); }
  }
  async function inspect(item) {
    const record = { url: item.url, origin: item.origin, score: item.score };
    report.pages.push(record);
    try {
      let html;
      try {
        const response = await axios.get(item.url, { timeout: 10000, maxContentLength: 3 * 1024 * 1024,
          headers: { 'User-Agent': userAgent, Accept: 'text/html' } });
        if (!String(response.headers['content-type'] || '').includes('html')) { record.reason = 'not-html'; return; }
        html = response.data;
      } catch { /* Browser fallback for relevant candidates only. */ }
      if (typeof html !== 'string' || needsBrowser(html)) {
        html = await rendered(item.url);
        record.rendered = true;
      }
      const kind = item.kind === 'listing' ? 'listing' : pageKind(html, item.url);
      record.kind = kind;
      // A listing is a source of links, never a hackathon itself.
      if (item.depth < 2 && kind !== 'irrelevant') {
        for (const linked of eventLinks(html, item.url, now)) add({ ...linked, depth: item.depth + 1 });
      }
      if (kind !== 'event') { record.reason = kind; return; }
      const diagnostics = {};
      let parsed = parseExactHackathonPage(html, item.url, { now, diagnostics });
      // Some SPAs serve substantial shells. Retry based on parse failure, not HTML byte length.
      if (!parsed && diagnostics.reason !== 'expired-registration-deadline' && !record.rendered && /<script[^>]+src=/i.test(html)) {
        html = await rendered(item.url);
        record.rendered = true;
        if (item.depth < 2) for (const linked of eventLinks(html, item.url, now)) add({ ...linked, depth: item.depth + 1 });
        if (pageKind(html, item.url) !== 'event') { record.reason = 'rendered-not-event'; return; }
        parsed = parseExactHackathonPage(html, item.url, { now, diagnostics });
      }
      if (!parsed) { record.reason = diagnostics.reason || 'unparseable-event'; return; }
      if (!isHackathon(parsed, html)) { record.reason = 'not-a-hackathon'; return; }
      const event = { ...parsed, location: parsed.place, endDate: parsed.registrationDeadline,
        source: 'web-discovery', isKeralaRelevant: Boolean(keralaPriority({ location: parsed.place })) };
      if (!shouldKeepHackathon(event)) { record.reason = 'outside-allowed-region-or-unknown-venue'; return; }
      events.push(event);
      record.reason = 'accepted';
      report.accepted.push({ name: event.name, url: event.sourceUrl, location: event.location, deadline: event.registrationDeadline });
      state.data.pages[item.url] = { title: event.name, seenAt: now.getTime(), deadline: event.registrationDeadline };
      console.log(`Accepted: ${event.name} | ${event.location} | ${event.registrationDeadline}`);
    } catch (error) {
      record.reason = 'fetch-or-render-failed';
      record.status = error.response?.status || error.code || error.name;
    }
  }
  try {
    while (visited.size < pageLimit) {
      const batch = [...candidates.values()].filter(item => !visited.has(item.url))
        .sort((a, b) => b.score - a.score).filter(item => (perHost.get(new URL(item.url).hostname) || 0) < 8)
        .slice(0, Math.min(3, pageLimit - visited.size));
      if (!batch.length) break;
      for (const item of batch) {
        visited.add(item.url);
        const host = new URL(item.url).hostname;
        perHost.set(host, (perHost.get(host) || 0) + 1);
      }
      await Promise.allSettled(batch.map(inspect));
    }
  } finally {
    if (browserPromise) { try { await (await browserPromise).close(); } catch {} }
    // Bound persistent URL storage and save diagnostics even after a partial failure.
    state.data.pages = Object.fromEntries(Object.entries(state.data.pages).sort((a, b) => b[1].seenAt - a[1].seenAt).slice(0, 500));
    state.save();
    report.usage = state.data.usage;
    report.deferred = candidates.size - visited.size;
    const file = options.reportFile || path.join(__dirname, 'discoveryReport.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`Discovery inspected ${visited.size} pages; accepted ${events.length}; ${report.deferred} deferred. Report: ${file}`);
  }
  return events;
}
module.exports = { discoverViaSearch };
if (require.main === module) discoverViaSearch().catch(error => { console.error(error.name); process.exitCode = 1; });
