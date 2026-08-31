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
