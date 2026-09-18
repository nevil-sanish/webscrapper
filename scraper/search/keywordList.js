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
module.exports = { keralaDistricts, keralaKeywords, otherStateKeywords, searchKeywords };
