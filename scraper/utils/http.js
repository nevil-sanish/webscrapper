const axios = require('axios');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// A timeout or rate limit on one request must not cost a hackathon, so
// transient failures are retried; a 4xx that will never succeed is not.
function isTransient(error) {
  const status = error.response?.status;
  return !status || status >= 500 || status === 429 || status === 408;
}

async function withRetry(request, { attempts = 3, delayMs = 1000 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request();
    } catch (error) {
      if (attempt >= attempts || !isTransient(error)) throw error;
      await sleep(delayMs * attempt);
    }
  }
}

// axios is looked up per call so tests can substitute its methods.
const getWithRetry = (url, config, retry) => withRetry(() => axios.get(url, config), retry);
const postWithRetry = (url, body, config, retry) => withRetry(() => axios.post(url, body, config), retry);

module.exports = { sleep, withRetry, getWithRetry, postWithRetry };
