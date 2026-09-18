const fs = require('fs');
const path = require('path');

function loadState(file = path.join(__dirname, 'discoveryState.json'), now = new Date()) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* First run. */ }
  const month = now.toISOString().slice(0, 7);
  data.queries ||= {};
  data.pages ||= {};
  if (data.month !== month) { data.month = month; data.usage = {}; }
  data.usage ||= {};
  function save() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }
  function reserve(provider, limit) {
    if ((data.usage[provider] || 0) >= limit) return false;
    data.usage[provider] = (data.usage[provider] || 0) + 1;
    save(); // Count attempted requests conservatively, including failures.
    return true;
  }
  function cached(query) {
    const entry = data.queries[query];
    return entry && now.getTime() - entry.at < 3 * 86400000 ? entry.result : null;
  }
  function remember(query, result) {
    data.queries[query] = { at: now.getTime(), result };
    for (const [q, entry] of Object.entries(data.queries)) {
      if (now.getTime() - entry.at > 30 * 86400000) delete data.queries[q];
    }
    save();
  }
  return { data, save, reserve, cached, remember };
}
module.exports = { loadState };
