const cheerio = require('cheerio');
const { plainText } = require('../utils/eventPolicy');
const socialHosts = ['facebook.com', 'instagram.com', 'linkedin.com', 'twitter.com', 'x.com', 'youtube.com', 'reddit.com'];
const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

function canonicalUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) return null;
    if (/\.(pdf|png|jpe?g|gif|svg|zip|mp4|css|js)$/i.test(url.pathname)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}
function isSocial(url) { return socialHosts.some(d => hostMatches(new URL(url).hostname, d)); }
function scoreCandidate(item, now = new Date()) {
  const text = `${item.title || ''} ${item.snippet || ''} ${item.url}`;
  let score = 0;
  if (/hackathon|hack[a-z]+|buildathon|ideathon/i.test(text)) score += 6;
  if (/kerala|thrissur|kottayam|kochi|kasaragod|kannur|kozhikode|palakkad|ernakulam/i.test(text)) score += 5;
  if (/register|registration|apply|deadline|official/i.test(text)) score += 3;
  if (text.includes(String(now.getFullYear()))) score += 3;
  if (/college|iedc|tinkerhub|mulearn|startupmission|\.edu\.in|\.ac\.in/i.test(text)) score += 3;
  if (/vercel\.app|netlify\.app|github\.io/i.test(item.url)) score += 2;
  if (/top \d+|best \d+|what is|tutorial|course|interview|jobs|salary/i.test(text)) score -= 12;
  const years = text.match(/\b20\d{2}\b/g) || [];
  if (years.length && years.every(y => Number(y) < now.getFullYear())) score -= 6;
  if (/knowafest\.com|internshala\.com|scouts\.yutori\.com/.test(item.url)) score -= 4;
  return score;
}
function pageKind(html, url = '') {
  const $ = cheerio.load(html);
  try {
    if (/^\/(?:events|hackathons|competitions)\/?$/.test(new URL(url).pathname)) return 'listing';
  } catch {}
  const title = $('title').text();
  const heading = $('h1').first().text();
  const text = plainText($('body').html());
  const metadata = $('meta[name="description"]').attr('content') || '';
  if (!/hackathon|hack[a-z]+|buildathon/i.test(`${title} ${heading} ${metadata} ${text}`)) return 'irrelevant';
  if (/what is|tutorial|course|top \d+|best \d+|hackathon ideas/i.test(`${title} ${heading}`)) return 'article';
  if (/^(?:events|hackathons|upcoming events|upcoming hackathons|hackathon finder)\b/i.test(title.trim()) ||
      /^events$|^upcoming hackathons$/i.test(heading.trim())) return 'listing';
  return 'event';
}
function needsBrowser(html) {
  const $ = cheerio.load(html);
  const visible = plainText($('body').html()).trim();
  return visible.length < 150 || (/enable javascript|javascript is required/i.test(visible));
}
function eventLinks(html, base, now = new Date()) {
  const $ = cheerio.load(html);
  const links = new Map();
  $('a[href]').each((_, el) => {
    const a = $(el);
    const raw = a.attr('href');
    if (!raw || raw.startsWith('#')) return;
    const url = canonicalUrl(raw, base);
    if (!url || isSocial(url) || url === canonicalUrl(base)) return;
    const title = a.text().trim();
    const context = a.parent().text().replace(/\s+/g, ' ').slice(0, 400);
    if (!/hackathon|hack[a-z]+|buildathon|official website|event website/i.test(`${title} ${url} ${context}`)) return;
    if (/\/login|\/privacy|\/terms|\/contact|\/auth|accounts\.google|forms\.gle|docs\.google/i.test(url)) return;
    // Avoid navigation links that merely inherit an entire page's hackathon text.
    if (!/hack|buildathon|official|website|register|learn more|details/i.test(`${title} ${url}`)) return;
    const item = { url, title, snippet: context, origin: base };
    item.score = scoreCandidate(item, now);
    links.set(url, item);
  });
  return [...links.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}
function namedQuery(item, year) {
  const title = String(item.title || '').replace(/\s*\|.*$/, '').trim();
  const name = title.match(/\b(?:hack[a-z][\w'-]*|[A-Z][a-z]+(?:[ -][A-Z][a-z]+)?\s+Hackathon)(?:\s*[’']?\d{1,4}(?:\.\d+)?)?/i)?.[0];
  if (!name || /^(hackathon|hackathons|hacking|hacker|hackerearth)$/i.test(name)) return null;
  return `"${name}" ${year} official hackathon registration Kerala`;
}
module.exports = { canonicalUrl, isSocial, scoreCandidate, pageKind, needsBrowser, eventLinks, namedQuery };
