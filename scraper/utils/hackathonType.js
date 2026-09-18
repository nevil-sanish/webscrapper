const { plainText } = require('./eventPolicy');
// Competition platforms list quizzes, hiring tests and giveaways alongside hackathons.
function isHackathon({ name = '', description = '', tags = [] }, content = '') {
  const title = name.toLowerCase();
  const text = plainText(`${name} ${content || description} ${tags.join(' ')}`).toLowerCase();
  const builds = /\b(?:build|develop|create|prototype|project|product|solution|mvp|demo)\b/.test(text);
  const explicit = /\bhackathon\b|\bbuildathon\b|\bhackfest\b/.test(text);
  if (/\b(?:quiz|webinar|workshop|course|internship|hiring|job|giveaway|scholarship|ctf|capture the flag|bug bounty)\b/.test(title)) return false;
  if (/coding challenge|coding contest|spot the vulnerability|agent passport|web scraper challenge/.test(title) && !(explicit && builds)) return false;
  return explicit || (/\bhack[a-z0-9]+\b/.test(title) && builds);
}
module.exports = { isHackathon };
