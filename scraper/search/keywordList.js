const keralaDistricts = [
  'Thiruvananthapuram', 'Kollam', 'Pathanamthitta', 'Alappuzha',
  'Kottayam', 'Idukki', 'Ernakulam', 'Thrissur', 'Palakkad',
  'Malappuram', 'Kozhikode', 'Wayanad', 'Kannur', 'Kasaragod'
];
const districtAliases = ['Trivandrum', 'Quilon', 'Alleppey', 'Kochi', 'Cochin',
  'Trichur', 'Palghat', 'Calicut', 'Cannanore', 'Kannaur', 'Kasargod'];
const keralaKeywords = [
  ...keralaDistricts.flatMap(district => [
    `hackathon in ${district} Kerala registration`,
    `upcoming college hackathon in ${district} Kerala`,
    `site:unstop.com hackathon ${district} Kerala`,
    `site:devfolio.co hackathon ${district} Kerala`
  ]),
  ...districtAliases.map(city => `hackathon in ${city} Kerala`),
  'upcoming hackathons Kerala registration',
  'Kerala hackathon online round offline finals',
  'Kerala college student hackathon registration',
  'site:unstop.com hackathons Kerala',
  'site:devfolio.co hackathons Kerala'
];
const otherStateKeywords = [
  'upcoming hackathons Tamil Nadu registration',
  'upcoming hackathons Karnataka registration',
  'hackathon Chennai Tamil Nadu',
  'hackathon Bengaluru Karnataka'
];
const searchKeywords = [...keralaKeywords, ...otherStateKeywords];
// All districts remain covered. Broader source-specific queries find college sites
// and independently hosted events; two slots are reserved for named-event followups.
function getDiscoveryPlan(now = new Date()) {
  const year = now.getFullYear();
  const day = Math.floor(now.getTime() / 86400000);
  const variants = [
    d => `${d} Kerala hackathon ${year}`,
    d => `${d} Kerala college hackathon register ${year}`,
    d => `${d} Kerala IEDC hackathon ${year}`
  ];
  const districts = keralaDistricts.map((d, i) => variants[(day + i) % variants.length](d));
  const sources = [
    `Kerala hackathon ${year} site:vercel.app`,
    `Kerala hackathon ${year} site:netlify.app`,
    `Kerala hackathon ${year} site:github.io`,
    `Kerala IEDC hackathon ${year} registration`,
    `Kerala TinkerHub hackathon ${year} registration`,
    `Kerala MuLearn hackathon ${year} registration`,
    `Kerala engineering college hackathon ${year} official website`,
    `Kerala hackathon ${year} site:ac.in`
  ];
  const offset = day % sources.length;
  return { initial: [...districts, sources[offset], sources[(offset + 1) % sources.length],
    `Tamil Nadu college hackathon ${year} registration`, `Karnataka college hackathon ${year} registration`],
    followupFallback: [sources[(offset + 2) % sources.length], sources[(offset + 3) % sources.length]] };
}
function getRunKeywords(now = new Date()) {
  const plan = getDiscoveryPlan(now);
  return [...plan.initial, ...plan.followupFallback];
}
module.exports = { keralaDistricts, keralaKeywords, otherStateKeywords, searchKeywords, getRunKeywords, getDiscoveryPlan };
