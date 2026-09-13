const Groq = require('groq-sdk');
require('dotenv').config();

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const SYSTEM_PROMPT = `You are an expert data extraction engine specializing in hackathons.
Given a fragment of HTML or text from a hackathon webpage, extract every hackathon and return ONLY a valid JSON array matching this schema:
[{
  "name": string,
  "startDate": string (CRITICAL: Must be the Registration / Application Deadline date in ISO 8601 YYYY-MM-DD. DO NOT use the event conduction date or runs-from date!),
  "endDate": string (ISO 8601 or null),
  "registrationDeadline": string (ISO 8601 YYYY-MM-DD, the last date to register or submit application),
  "location": string (Format exactly as "City, State", e.g., "Kochi, Kerala", or "Online"),
  "mode": string (must be exactly one of: "online", "offline", "both", or null),
  "organizer": string or null,
  "prize": string or null,
  "eligibility": string or null,
  "tags": string[],
  "sourceUrl": string
}]
Remember: The primary event date ('startDate') MUST be the last date for registration / application cutoff. If unknown, use null. Do not invent data. Return ONLY JSON.`;

/**
 * Extracts hackathon data from text using Groq LLM
 * @param {string} text - The cleaned text from the webpage
 * @param {string} sourceUrl - The URL it was scraped from, to enforce it in the output
 * @returns {Promise<Array>} - Array of hackathon objects
 */
async function extractHackathons(text, sourceUrl) {
  if (!text) return [];

  // Cap text to max 4000 characters (~1000 tokens) to safely stay below Groq's 7000 ITPM rate limit
  const safeText = text.length > 4000 ? text.slice(0, 4000) : text;
  const prompt = `Source URL to use: ${sourceUrl}\n\nContent:\n${safeText}`;

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
        // Ensure startDate is set to registrationDeadline if available
        for (let h of parsed) {
          if (h.registrationDeadline) {
            h.startDate = h.registrationDeadline;
          }
        }
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

/**
 * Uses LLM to identify the exact registration/submission closing date from a hackathon's stages and timelines text.
 * Highly token-efficient (<250 input tokens, ~20 output tokens).
 * @param {string} timelineText - Text containing rounds, stages, and timelines
 * @param {string} title - The title of the hackathon
 * @returns {Promise<string|null>} - ISO 8601 date string (YYYY-MM-DD) or null
 */
async function extractRegistrationDeadlineFromTimeline(timelineText, title) {
  if (!timelineText || !timelineText.trim()) return null;

  const prompt = `Hackathon: ${title || 'Unknown'}
Stages and Timelines schedule:
${timelineText}

Identify the date when REGISTRATION or initial project/team SUBMISSION closes (the last date a participant can sign up or submit their entry to be considered).
Return ONLY a JSON object: {"registrationDeadline": "YYYY-MM-DD"} or {"registrationDeadline": null}. No prose, no markdown fences.`;

  try {
    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: 'You are a precise date extraction engine. Output ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      model: 'qwen/qwen3.8-27b',
      temperature: 0,
      max_tokens: 60
    });

    const content = completion.choices[0]?.message?.content?.trim() || '';
    const cleanJson = content.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/i, '').trim();
    let parsed = null;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (e) {
      const match = cleanJson.match(/\d{4}-\d{2}-\d{2}/);
      if (match) return match[0];
    }

    if (parsed && typeof parsed === 'object' && parsed.registrationDeadline) {
      return String(parsed.registrationDeadline).trim();
    }
    const dateMatch = cleanJson.match(/\d{4}-\d{2}-\d{2}/);
    return dateMatch ? dateMatch[0] : null;
  } catch (err) {
    console.error(`Error in extractRegistrationDeadlineFromTimeline for "${title}":`, err.message);
    return null;
  }
}

module.exports = { extractHackathons, extractRegistrationDeadlineFromTimeline };
