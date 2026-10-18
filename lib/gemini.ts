import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import {
  ScrapeResult,
  LessonOutline,
  ChapterDossier,
  CompletedChapter,
  ActiveLessonBuild,
  LessonStreamEvent
} from './types';
import { saveActiveLessonBuild, fetchActiveLessonBuild } from './supabase';

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

export async function planLessonCurriculum(userPrompt: string): Promise<LessonOutline> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const prompt = `You are an elite music historian, ethnomusicologist, and podcast executive producer. The listener wants an exhaustive, deep-dive podcast episode on: '${userPrompt}'.

Plan a master-class podcast episode consisting of an introduction hook, 5 to 6 extensive chapters, and a conclusion.

Return a strict JSON object with this exact structure:
{
  "title": "Short, punchy, direct episode title (maximum 5-8 words, strictly no fluff or clickbait)",
  "intro": "Brief spoken hook, cultural setting, and thesis of the episode (approx 150-200 words)",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "Descriptive and evocative chapter title",
      "historical_context_reasons": "Detailed societal backdrop, cultural catalysts, or economic/political tensions driving this chapter's sound",
      "artist_spotlight": "Name of the primary artist or band featured, their background, instrumental setup, and artistic impact to explore",
      "musical_theory_focus": "Specific sound design, rhythm, scales, or studio techniques to dissect in this chapter",
      "featured_song": {
        "title": "Exact Song Title",
        "artist": "Artist Name",
        "year": "1971",
        "narrative_context": "Why this track exemplifies the chapter"
      },
      "key_talking_points": [
        "Point 1",
        "Point 2",
        "Point 3",
        "Point 4"
      ]
    }
  ],
  "conclusion": "Summary of legacy, ripple effects on modern music, and final thoughts (approx 150-250 words)"
}

Do NOT include Markdown formatting fences or introductory text. Return only valid, parseable JSON.`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Fallback: extract the JSON substring between first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  const parsed: LessonOutline = JSON.parse(text);
  if (!parsed.chapters || !Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    throw new Error('Gemini failed to generate structured chapters in syllabus outline.');
  }

  return parsed;
}

export async function generateLessonChapter(
  episodeTitle: string,
  chapterBrief: ChapterDossier,
  previousChapterEnding: string = '',
  isFirst: boolean = false,
  isLast: boolean = false
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const searchQuery = encodeURIComponent(
    `${chapterBrief.featured_song.artist} ${chapterBrief.featured_song.title}`.replace(/\s+/g, '+')
  );

  const prompt = `You are the charismatic world-expert host of this deep-dive music podcast.
Episode: '${episodeTitle}'.
You are speaking Chapter ${chapterBrief.chapter_number}: '${chapterBrief.title}'.

YOUR MANDATE FOR THIS CHAPTER:
- Historical context & reasons: Explain why this sound emerged in this specific time and place (${chapterBrief.historical_context_reasons}).
- Dedicate significant time to the artist spotlight: ${chapterBrief.artist_spotlight}. Explain their upbringing, their instruments/gear, their struggle, and their mindset.
- Break down the musical theory and production: ${chapterBrief.musical_theory_focus}. Make technical musical concepts (rhythms, scales, studio techniques) vivid and engaging for a listener.
- Track Curation & Additional Songs:
  - Introduce the primary planned track: [Play "${chapterBrief.featured_song.title}" by ${chapterBrief.featured_song.artist} on YouTube](https://www.youtube.com/results?search_query=${searchQuery}) and analyze its specific moments, riffs, or rhythms.
  - Freedom to add more songs: If you feel it helps illustrate the artist's range, evolution, or a pivotal contrast, you are expressly encouraged to introduce 1 or 2 additional songs by this artist (or their close collaborators/influences). Every additional song must also be embedded organically with its YouTube search query link: [Play "Song Title" by Artist on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title).
- Cover all chapter talking points thoroughly:
${chapterBrief.key_talking_points.map((p) => `- ${p}`).join('\n')}

${previousChapterEnding ? `Bridge naturally from the preceding chapter context: "${previousChapterEnding.slice(-300)}"` : ''}

Target length: 900 to 1,200 words for this chapter alone. Be rich, articulate, and vivid.

CRITICAL SPOKEN RULES:
- Write purely spoken narration meant to be read directly aloud by a voice synthesizer.
- Absolutely NO sound directions: no '(Intro music fades in...)', no '[Applause]', no '(Drum roll)'.
- Absolutely NO speaker labels: no '**Host:**', no 'Host:', no 'Narrator:'.
- Format this chapter with its title as a Markdown h2 at the very beginning: ## ${chapterBrief.title}
- ${isLast ? 'Provide a natural conclusion summarizing the legacy and ripple effects of this movement.' : 'Do NOT conclude or wrap up the entire podcast in this chapter; end with a natural bridge to the next topic.'}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // Ensure chapter starts with ## heading
  if (!text.startsWith('## ')) {
    text = `## ${chapterBrief.title}\n\n${text}`;
  }

  return text;
}

export async function generateFullLessonV2(
  userPrompt: string,
  onEvent?: (event: LessonStreamEvent) => Promise<void> | void,
  resumeFromChapterIndex: number = 0
): Promise<{ title: string; content: string }> {
  let existingDraft = await fetchActiveLessonBuild();
  let outline: LessonOutline;

  // 1. Phase 1: Planning / Syllabus Outline
  if (existingDraft && existingDraft.outline_json && resumeFromChapterIndex > 0) {
    outline = existingDraft.outline_json;
    if (onEvent) {
      await onEvent({ type: 'status', message: `Resuming podcast "${outline.title}" from Chapter ${resumeFromChapterIndex + 1}...` });
      await onEvent({ type: 'outline', data: outline });
    }
  } else {
    if (onEvent) {
      await onEvent({ type: 'status', message: '🧠 Gemini is designing the episode syllabus (structuring chapters, selecting artists & curating songs)...' });
    }

    // Save initial planning status to DB
    await saveActiveLessonBuild({
      topic_prompt: userPrompt,
      status: 'planning',
      current_step: 'planning_syllabus'
    });

    outline = await planLessonCurriculum(userPrompt);

    // Save outline to DB
    await saveActiveLessonBuild({
      topic_prompt: userPrompt,
      title: outline.title,
      outline_json: outline,
      chapters_json: [],
      content: `# ${outline.title}\n\n${outline.intro}`,
      status: 'in_progress',
      current_step: 'syllabus_ready'
    });

    if (onEvent) {
      await onEvent({ type: 'outline', data: outline });
      await onEvent({ type: 'status', message: `✓ Syllabus created: "${outline.title}". Writing Chapter 1/${outline.chapters.length}...` });
    }
  }

  // 2. Phase 2: Sequential Chapter Writing
  const completedChapters: CompletedChapter[] =
    resumeFromChapterIndex > 0 && existingDraft?.chapters_json
      ? existingDraft.chapters_json.slice(0, resumeFromChapterIndex)
      : [];

  let accumulatedContent = `# ${outline.title}\n\n${outline.intro}`;
  if (completedChapters.length > 0) {
    accumulatedContent += '\n\n' + completedChapters.map((c) => c.text).join('\n\n');
  }

  for (let i = completedChapters.length; i < outline.chapters.length; i++) {
    const chapterBrief = outline.chapters[i];
    const isFirst = i === 0;
    const isLast = i === outline.chapters.length - 1;

    const previousEnding =
      completedChapters.length > 0
        ? completedChapters[completedChapters.length - 1].text.slice(-400)
        : outline.intro;

    if (onEvent) {
      await onEvent({
        type: 'status',
        message: `✍️ Gemini is writing Chapter ${i + 1}/${outline.chapters.length}: "${chapterBrief.title}" (spotlighting ${chapterBrief.artist_spotlight.split(',')[0].slice(0, 35)})...`,
        step: `chapter_${i + 1}`
      });
    }

    const chapterText = await generateLessonChapter(outline.title, chapterBrief, previousEnding, isFirst, isLast);
    const wordCount = chapterText.split(/\s+/).filter(Boolean).length;

    const completed: CompletedChapter = {
      chapter_number: chapterBrief.chapter_number,
      title: chapterBrief.title,
      text: chapterText,
      wordCount
    };

    completedChapters.push(completed);
    accumulatedContent += `\n\n${chapterText}`;

    // Update active build in DB progressively
    await saveActiveLessonBuild({
      topic_prompt: userPrompt,
      title: outline.title,
      outline_json: outline,
      chapters_json: completedChapters,
      content: accumulatedContent,
      status: 'in_progress',
      current_step: `chapter_${i + 1}_ready`
    });

    if (onEvent) {
      await onEvent({
        type: 'chapter',
        chapterIndex: i,
        chapter: completed,
        accumulatedContent
      });

      if (!isLast) {
        await onEvent({
          type: 'status',
          message: `⚡ Chapter ${i + 1} received (${wordCount} words). Starting Chapter ${i + 2}: "${outline.chapters[i + 1].title}"...`
        });
      }
    }
  }

  // 3. Append Conclusion if present and not already concluding
  if (outline.conclusion && !accumulatedContent.includes('## Conclusion')) {
    const conclusionMarkdown = `## Conclusion\n\n${outline.conclusion}`;
    accumulatedContent += `\n\n${conclusionMarkdown}`;
  }

  const totalWords = accumulatedContent.split(/\s+/).filter(Boolean).length;

  // Finalize active build state
  await saveActiveLessonBuild({
    topic_prompt: userPrompt,
    title: outline.title,
    outline_json: outline,
    chapters_json: completedChapters,
    content: accumulatedContent,
    status: 'completed',
    current_step: 'completed'
  });

  if (onEvent) {
    await onEvent({
      type: 'complete',
      lesson: {
        title: outline.title,
        content: accumulatedContent,
        totalWords
      }
    });
  }

  return { title: outline.title, content: accumulatedContent };
}

export async function generateLessonGemini(userPrompt: string): Promise<{ title: string; content: string }> {
  // Uses V2 multi-step generation pipeline
  return generateFullLessonV2(userPrompt);
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

  const prompt = `You are a world music expert. You helped the user with his original intent '${originalPrompt}', you returned '${previousLesson}', now the user wants to '${userSuggestion}'. Return the modified lesson, maintaining a short, direct, no-nonsense top # Lesson Title (maximum 5-8 words, no fluff or clickbait), format, tone, structure, and inline YouTube song links placed within the text.

Adhere strictly to the spoken text rules:
- Write purely spoken narration meant to be read directly aloud by a voice synthesizer.
- No sound cues/directions (NO '(intro music fades in)', NO '[applause]', NO '(music)').
- No speaker labels (NO '**Host:**', 'Host:', 'Narrator:').
- Ensure YouTube links are placed inline within the text where songs are discussed, formatted as https://www.youtube.com/results?search_query=Artist+Song+Title.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  let title = originalPrompt.slice(0, 60);
  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim().replace(/\*+/g, '').replace(/^["']|["']$/g, '');
  }

  return { title, content: text };
}
