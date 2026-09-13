const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT),
  secure: true, // Use SSL
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * Sends an email report of new hackathons
 * @param {Array} inserted - Array of newly inserted hackathon documents
 */
async function sendEmailReport(inserted) {
  if (!inserted || inserted.length === 0) {
    console.log('No new hackathons to report.');
    return;
  }

  const emailTo = process.env.REPORT_EMAIL;
  
  let htmlContent = `
    <h2>New Hackathons Found (${inserted.length})</h2>
    <table border="1" cellpadding="10" style="border-collapse: collapse;">
      <tr>
        <th>Name</th>
        <th>Dates</th>
        <th>Location</th>
        <th>Source</th>
        <th>Link</th>
      </tr>
  `;

  for (let h of inserted) {
    const dates = h.startDate ? h.startDate.toDateString() : 'Unknown';
    htmlContent += `
      <tr>
        <td><strong>${h.name}</strong> ${h.isKeralaRelevant ? '⭐' : ''}</td>
        <td>${dates}</td>
        <td>${h.location || 'Online/Unknown'}</td>
        <td>${h.source}</td>
        <td><a href="${h.sourceUrl}">View</a></td>
      </tr>
    `;
  }

  htmlContent += `</table><br><p>⭐ indicates potentially relevant to Kerala students.</p>`;

  const mailOptions = {
    from: `"Hack Scrapper" <${process.env.SMTP_USER}>`,
    to: emailTo,
    subject: `New Hackathons Found! (${inserted.length})`,
    html: htmlContent,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Report email sent:', info.messageId);
  } catch (error) {
    console.error('Error sending email report:', error.message);
  }
}

module.exports = { sendEmailReport };
