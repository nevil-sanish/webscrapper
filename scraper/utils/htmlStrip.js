const cheerio = require('cheerio');

/**
 * Strips unnecessary HTML tags (scripts, styles, nav, etc.) 
 * to reduce the token count before passing to the LLM.
 * @param {string} html - The raw HTML fragment
 * @returns {string} - Cleaned text or minimized HTML
 */
function stripHtmlForLlm(html) {
  if (!html) return '';
  const $ = cheerio.load(html);
  
  // Remove elements that don't contain hackathon info
  $('script, style, nav, footer, header, svg, img, iframe, noscript').remove();
  
  // Return plain text with some spacing, or basic html.
  // Using text() gets rid of all tags, which is usually best for LLM token count.
  // We can format it slightly by adding newlines after blocks.
  $('div, p, section, h1, h2, h3, h4, h5, h6, li').append('\n');
  
  const text = $.text().replace(/\n\s*\n/g, '\n').trim();
  return text;
}

module.exports = { stripHtmlForLlm };
