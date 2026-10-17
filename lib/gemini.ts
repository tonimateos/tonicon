import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { ScrapeResult } from './types';

export async function scrapeConcertUrl(url: string): Promise<ScrapeResult> {
  let htmlText = '';
  let ogTitle = '';
  let pageTitle = '';

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      next: { revalidate: 0 }
    });

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      // Remove noise
      $('script, style, noscript, svg, nav, footer, iframe').remove();

      ogTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || '';
      pageTitle = $('title').text() || '';

      // Get readable text snippet
      htmlText = $('body').text().replace(/\s+/g, ' ').slice(0, 4000);
    }
  } catch (fetchErr) {
    console.warn('Direct web fetch failed or restricted, analyzing URL and title:', fetchErr);
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const modelName = (process.env.GEMINI_MODEL || 'gemini-2.0-flash').replace(/^["']|["']$/g, '').trim();
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `You are a concert event parser. Extract concert details from the provided webpage text or title.
Webpage URL: ${url}
OG Title: ${ogTitle}
Page Title: ${pageTitle}
Webpage Body Snippet: ${htmlText}

Return ONLY a strict valid JSON object with the following fields:
- "band_name": string (Name of the performing band or artist)
- "venue_name": string (Name of the venue or location where concert takes place)
- "date": string (ISO 8601 date string e.g. "2026-10-15T20:00:00Z" or "2026-10-15". If year is omitted in text, assume the current or next upcoming year 2026).

Do NOT include Markdown code fences or extra words. Output only pure JSON.`;

      const result = await model.generateContent(prompt);
      const textResponse = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

      const parsed = JSON.parse(textResponse);
      if (parsed.band_name && parsed.venue_name && parsed.date) {
        return {
          band_name: String(parsed.band_name),
          venue_name: String(parsed.venue_name),
          date: new Date(parsed.date).toISOString()
        };
      }
    } catch (geminiErr) {
      console.error('Gemini parsing error:', geminiErr);
    }
  }

  // Fallback Heuristic Parsing if Gemini API key is missing or failed
  return fallbackHeuristicScrape(url, ogTitle || pageTitle || htmlText);
}

function fallbackHeuristicScrape(url: string, rawText: string): ScrapeResult {
  // Extract plausible names from title or URL
  let bandName = 'Unknown Band';
  let venueName = 'Venue TBD';
  let concertDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();

  try {
    const cleanTitle = rawText.split('|')[0].split('-')[0].trim();
    if (cleanTitle && cleanTitle.length > 2) {
      bandName = cleanTitle;
    } else {
      // Extract from URL pathname
      const parsedUrl = new URL(url);
      const segments = parsedUrl.pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        bandName = segments[segments.length - 1].replace(/[-_]/g, ' ').replace(/\d+/g, '').trim();
        bandName = bandName.charAt(0).toUpperCase() + bandName.slice(1);
      }
    }
  } catch (e) {
    console.error('Fallback URL parse error:', e);
  }

  return {
    band_name: bandName || 'Live Band',
    venue_name: venueName,
    date: concertDate
  };
}

export async function generateLessonGemini(userPrompt: string): Promise<{ title: string; content: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are a world music expert. The user wants to learn about the following: '${userPrompt}'. First, return an engaging and concise Lesson Title derived from the user query (formatted as an h1 tag at the very top: # Lesson Title). Then return a detailed lesson that looks like a long podcast. There must be an introduction, a main body divided into chapters with bold titles as h2 tags, and a conclusion. Within the text, insert songs (title, band name, year) as they are referenced in the lesson. Add a section at the end where you list the songs and bands that were mentioned in the lesson, with their respective Spotify and YouTube links.

Format requirements for Spotify and YouTube links:
Format each song link as direct web search query URLs so that they never 404:
- Spotify link format: [Listen on Spotify](https://open.spotify.com/search/Artist%20Song%20Title)
- YouTube link format: [Watch on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title)

Write in an engaging, conversational, immersive podcast storytelling voice.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  let title = userPrompt.slice(0, 60);
  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim().replace(/\*+/g, '');
  }

  return { title, content: text };
}

export async function refineLessonGemini(
  originalPrompt: string,
  previousLesson: string,
  userSuggestion: string
): Promise<{ title: string; content: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are a world music expert. You helped the user with his original intent '${originalPrompt}', you returned '${previousLesson}', now the user wants to '${userSuggestion}'. Return the modified lesson, maintaining the top # Lesson Title (adjusting if appropriate), format, tone, and structure.

Ensure songs are referenced with title, band name, year, and linked with valid search query links for Spotify (https://open.spotify.com/search/...) and YouTube (https://www.youtube.com/results?search_query=...).`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  let title = originalPrompt.slice(0, 60);
  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim().replace(/\*+/g, '');
  }

  return { title, content: text };
}
