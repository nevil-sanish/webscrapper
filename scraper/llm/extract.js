const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `You are a data extraction engine. You will be given a fragment of HTML or text from a hackathon listing page. Extract every hackathon you can identify and return ONLY a valid JSON array, no prose, no markdown fences, matching this schema exactly:
[{
  "name": string,
  "startDate": string (ISO 8601 or null if unknown),
  "endDate": string (ISO 8601 or null),
  "registrationDeadline": string (ISO 8601 or null),
  "location": string (Format exactly as "City, State", e.g., "Kochi, Kerala", or "Online"),
  "mode": string (must be exactly one of: "online", "offline", "both", or null),
  "organizer": string or null,
  "prize": string or null,
  "eligibility": string or null,
  "tags": string[],
  "sourceUrl": string
}]
If a field is not present in the text, use null. Do not invent data.`;

/**
 * Extracts hackathon data from text using Groq LLM
 * @param {string} text - The cleaned text from the webpage
 * @param {string} sourceUrl - The URL it was scraped from, to enforce it in the output
 * @returns {Promise<Array>} - Array of hackathon objects
 */
async function extractHackathons(text, sourceUrl) {
  if (!text) return [];

  const prompt = `Source URL to use: ${sourceUrl}\n\nContent:\n${text}`;

  let attempts = 0;
  while (attempts < 2) {
    attempts++;
    try {
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt }
        ],
        model: 'qwen/qwen3.8-27b',
        temperature: 0,
        max_tokens: 800
      });

      const responseContent = chatCompletion.choices[0].message.content.trim();
      // In case the model adds markdown formatting despite instructions
      const cleanJsonStr = responseContent.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
      
      let parsed = null;
      try {
        parsed = JSON.parse(cleanJsonStr);
      } catch (jsonErr) {
        // Recover from truncation by finding the last closed object
        const lastObjEnd = cleanJsonStr.lastIndexOf('}');
        if (lastObjEnd !== -1) {
          try {
            const recovered = cleanJsonStr.slice(0, lastObjEnd + 1) + ']';
            parsed = JSON.parse(recovered);
          } catch (e2) {}
        }
        if (!parsed) throw jsonErr;
      }
      
      // Validate output is array
      if (Array.isArray(parsed)) {
        return parsed;
      } else {
        console.error('LLM did not return an array. Returning empty array.');
        return [];
      }
    } catch (error) {
      console.error(`Error during LLM extraction for ${sourceUrl} (Attempt ${attempts}):`, error.message);
      if (attempts >= 2) {
        return [];
      }
    }
  }
}

module.exports = { extractHackathons };
