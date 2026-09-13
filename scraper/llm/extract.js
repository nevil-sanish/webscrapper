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
  "location": string,
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

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      model: 'qwen/qwen3.8-27b',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const responseContent = chatCompletion.choices[0].message.content.trim();
    // In case the model adds markdown formatting despite instructions
    const cleanJsonStr = responseContent.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    
    const parsed = JSON.parse(cleanJsonStr);
    
    // Validate output is array
    if (Array.isArray(parsed)) {
      return parsed;
    } else {
      console.error('LLM did not return an array. Returning empty array.');
      return [];
    }
  } catch (error) {
    console.error(`Error during LLM extraction for ${sourceUrl}:`, error.message);
    // Could implement 1 retry here, but keeping it simple for now
    return [];
  }
}

module.exports = { extractHackathons };
