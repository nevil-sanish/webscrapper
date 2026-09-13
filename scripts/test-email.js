require('dotenv').config();
const { sendEmailReport } = require('./email/sendReport');

async function testEmail() {
  console.log('Running Email Test...');
  const mockHackathons = [
    {
      name: 'Kerala Tech Hackathon 2026',
      isKeralaRelevant: true,
      startDate: new Date(),
      location: 'Kochi, Kerala',
      source: 'test-script',
      sourceUrl: 'https://example.com/kerala-hackathon'
    },
    {
      name: 'Global AI Summit',
      isKeralaRelevant: false,
      startDate: new Date(),
      location: 'Online',
      source: 'test-script',
      sourceUrl: 'https://example.com/global-ai'
    }
  ];

  await sendEmailReport(mockHackathons);
  console.log('Test complete!');
}

testEmail().catch(console.error);
