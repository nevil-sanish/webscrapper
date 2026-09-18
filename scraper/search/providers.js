const axios = require('axios');

function normalizeUrls(items, field) {
  const urls = new Set();
  for (const item of items) {
    try {
      const url = new URL(item?.[field]);
      if (url.protocol === 'http:' || url.protocol === 'https:') urls.add(url.href);
    } catch { /* Ignore malformed result links. */ }
  }
  return [...urls];
}

// Create once per discovery run so exhausted providers are not repeatedly called.
function createSearchClient({
  tavilyKey = process.env.TAVILY_API_KEY,
  serpKey = process.env.SERP_API_KEY,
  http = axios,
  logger = console,
  includeMetadata = false,
  reserve = () => true
} = {}) {
  let tavilyAvailable = Boolean(tavilyKey);
  let serpAvailable = Boolean(serpKey);

  async function search(query) {
    if (tavilyAvailable && !reserve('tavily')) tavilyAvailable = false;
    if (tavilyAvailable) {
      try {
        const { data } = await http.post('https://api.tavily.com/search', {
          query,
          search_depth: 'basic',
          auto_parameters: false,
          max_results: 10,
          include_answer: false,
          include_raw_content: false
        }, {
          headers: { Authorization: `Bearer ${tavilyKey}` },
          timeout: 30000
        });
        if (data?.error || !Array.isArray(data?.results)) throw new Error('Invalid Tavily response');
        // An empty successful result is not a failure: preserve backup credits.
        return { provider: 'tavily', urls: normalizeUrls(data.results, 'url'), ...(includeMetadata ? { results: data.results.map(r => ({ url: r.url, title: r.title || '', snippet: r.content || '' })) } : {}) };
      } catch (error) {
        const status = error.response?.status;
        if ([401, 403, 429, 432, 433].includes(status)) tavilyAvailable = false;
        // Never log Axios errors/configuration, which may contain API keys.
        logger.warn(`Tavily search failed (${status || 'network/response error'}); trying SerpApi backup.`);
      }
    }

    if (serpAvailable && !reserve('serpapi')) serpAvailable = false;
    if (serpAvailable) {
      try {
        const { data } = await http.get('https://serpapi.com/search.json', {
          params: { engine: 'google', q: query, api_key: serpKey, num: 10, gl: 'in', hl: 'en' },
          family: 4,
          timeout: 30000
        });
        if (data?.error) {
          if (/limit|quota|credit|plan|api.?key|unauthoriz/i.test(String(data.error))) serpAvailable = false;
          throw new Error('SerpApi response error');
        }
        if (!Array.isArray(data?.organic_results) && data?.search_information?.organic_results_state !== 'Fully empty') {
          throw new Error('Invalid SerpApi response');
        }
        return { provider: 'serpapi', urls: normalizeUrls(data.organic_results || [], 'link'), ...(includeMetadata ? { results: (data.organic_results || []).map(r => ({ url: r.link, title: r.title || '', snippet: r.snippet || '' })) } : {}) };
      } catch (error) {
        const status = error.response?.status;
        if ([401, 403, 429].includes(status)) serpAvailable = false;
        logger.warn(`SerpApi backup failed (${status || 'network/response error'}); skipping query.`);
      }
    }
    return { provider: null, urls: [] };
  }

  return { search, isAvailable: () => tavilyAvailable || serpAvailable };
}

module.exports = { createSearchClient };
