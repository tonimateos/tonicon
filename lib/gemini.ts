import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import {
  ScrapeResult,
  LessonOutline,
  ChapterDossier,
  CompletedChapter,
  ActiveLessonBuild,
  LessonStreamEvent,
  extractQuotaWaitTime,
  isQuotaError,
  GeminiQuotaExceededError
} from './types';
import { saveActiveLessonBuild, fetchActiveLessonBuild } from './supabase';
import { sanitizeTextForSpeech } from './lesson-parser';

export { extractQuotaWaitTime, isQuotaError, GeminiQuotaExceededError };

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
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseMimeType: 'application/json' }
      });

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
      const textResponse = result.response.text();

      const parsed = safeParseJSON<any>(textResponse);
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

/**
 * Safely parses JSON emitted by LLMs, cleanly extracting the balanced root JSON
 * structure even if the model appends trailing text, markdown backticks, or comments.
 */
export function safeParseJSON<T>(rawText: string): T {
  let text = (rawText || '').trim();

  // 1. Strip markdown code fences if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 2. Direct parse attempt
  try {
    return JSON.parse(text) as T;
  } catch (err: any) {
    // 3. Extract the balanced JSON object between first { and its matching }
    const firstBrace = text.indexOf('{');
    if (firstBrace !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      let matchedEnd = -1;

      for (let i = firstBrace; i < text.length; i++) {
        const char = text[i];
        if (escape) {
          escape = false;
          continue;
        }
        if (char === '\\') {
          escape = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0) {
              matchedEnd = i;
              break;
            }
          }
        }
      }

      if (matchedEnd !== -1) {
        const candidate = text.slice(firstBrace, matchedEnd + 1);
        try {
          return JSON.parse(candidate) as T;
        } catch (_) {
          // Fall through to error position extraction
        }
      }
    }

    // 4. Fallback: parse up to error position (e.g. "Unexpected non-whitespace character after JSON at position 25237")
    const posMatch = err.message?.match(/position\s+(\d+)/);
    if (posMatch && posMatch[1]) {
      const pos = parseInt(posMatch[1], 10);
      if (pos > 0 && pos <= text.length) {
        const prefix = text.slice(0, pos).trim();
        try {
          return JSON.parse(prefix) as T;
        } catch (_) {
          // ignore
        }
      }
    }

    throw err;
  }
}

export async function planLessonCurriculum(
  userPrompt: string,
  language: 'en' | 'es' = 'en'
): Promise<LessonOutline> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: { responseMimeType: 'application/json' }
  });

  const isSpanish = language === 'es';

  const prompt = isSpanish
    ? `Eres un erudito historiador musical, musicólogo y productor de podcasts culturales de prestigio (al estilo de Radio Clásica / Radio 3 de RNE, BBC Radio 4 o France Musique). El oyente busca un documental sonoro riguroso, sobrio y en profundidad sobre: '${userPrompt}'.

ESTILO Y TONO OBLIGATORIOS (CRÍTICO):
- Tono europeo, equilibrado, reflexivo, culto y ensayístico.
- CERO sensacionalismo, cero clichés de marketing y cero tópicos vacíos (está TERMINANTEMENTE PROHIBIDO usar expresiones efectistas o entusiasmo fingido como "¡esto te volará la cabeza!", "¡abróchate el cinturón!", "¡una auténtica locura!", "¡increíble!").
- Trata al oyente como a un adulto inteligente interesado en el contexto sociopolítico real, la teoría musical y la historia fáctica, sin fuegos artificiales ni postureo.
- AMPLITUD DE ARTISTAS: En cada capítulo, selecciona el artista o banda principal a analizar a fondo, pero incluye también nombres de otros artistas clave de la escena (coetáneos, influencias, bandas asociadas o pioneros locales) con una canción ilustrativa para cada uno.

Planifica un episodio magistral de 5 a 6 capítulos extensos, además de introducción y conclusión.

Devuelve EXCLUSIVAMENTE un objeto JSON estricto con esta estructura:
{
  "title": "Título del episodio conciso, sobrio y directo (máximo 5-8 palabras, sin adornos ni clickbait)",
  "language": "es",
  "intro": "Gancho introductorio narrado, marco histórico-social y tesis del episodio (aprox. 150-200 palabras)",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "Título temático del capítulo",
      "historical_context_reasons": "Contexto histórico, tensiones sociales o catalizadores culturales de este sonido",
      "artist_spotlight": "Artista o grupo principal a analizar a fondo, su instrumentación, técnica y visión",
      "musical_theory_focus": "Conceptos de armonía, ritmo, instrumentación o producción en estudio a desgranar",
      "featured_song": {
        "title": "Título exacto de la canción",
        "artist": "Nombre del artista",
        "year": "1971",
        "narrative_context": "Por qué este tema ejemplifica el sonido de este capítulo"
      },
      "additional_artists": [
        {
          "artist": "Nombre de artista coetáneo o influencia",
          "song_title": "Canción representativa",
          "context": "Breve relación con el movimiento o escena"
        }
      ],
      "key_talking_points": [
        "Punto 1",
        "Punto 2",
        "Punto 3",
        "Punto 4"
      ]
    }
  ],
  "conclusion": "Reflexión final sobria sobre el legado, mutaciones posteriores y cierre (aprox. 150-250 palabras)"
}

Devuelve ÚNICAMENTE el JSON válido, sin bloques de código ni texto adicional.`
    : `You are an erudite musicologist, cultural historian, and producer of serious audio documentaries (in the tradition of BBC Radio 3/4, France Musique, and Criterion/ECM audio essays). The listener wants a rigorous, exhaustive, deep-dive podcast episode on: '${userPrompt}'.

EDITORIAL TONE & CRITICAL MANDATE:
- Sober, measured, articulate, and thoughtful. European documentary essay style.
- STRICTLY NO AMERICAN PODCAST HYPERBOLE, clickbait phrasing, or commercial hype: ABSOLUTELY FORBIDDEN to use sensationalist fluff ("buckle up", "mind-blowing", "insane", "literally changed everything forever", "super excited", "OMG").
- Treat the listener as an intelligent adult seeking genuine historical context, social-cultural depth, music theory, and honest artistic critique without corporate or radio-DJ bullshit.
- WIDE ARTIST PANORAMA: In every chapter, identify not only the primary artist(s) for in-depth analysis, but also other notable artists (peers, predecessors, collaborators, or scene contemporaries) each with a concrete illustrative track.

Plan a master-class episode consisting of an introductory hook, 5 to 6 extensive chapters, and a conclusion.

Return a strict JSON object with this exact structure:
{
  "title": "Short, sober, direct episode title (maximum 5-8 words, strictly no fluff or clickbait)",
  "language": "en",
  "intro": "Spoken hook, cultural setting, and thesis of the episode (approx 150-200 words)",
  "chapters": [
    {
      "chapter_number": 1,
      "title": "Descriptive and thematic chapter title",
      "historical_context_reasons": "Detailed societal backdrop, cultural catalysts, or economic/political tensions driving this chapter's sound",
      "artist_spotlight": "Name of the primary artist or band featured, their background, instrumental setup, and artistic impact to explore",
      "musical_theory_focus": "Specific sound design, rhythm, scales, or studio techniques to dissect in this chapter",
      "featured_song": {
        "title": "Exact Song Title",
        "artist": "Artist Name",
        "year": "1971",
        "narrative_context": "Why this track exemplifies the chapter"
      },
      "additional_artists": [
        {
          "artist": "Artist Name",
          "song_title": "Illustrative Song Title",
          "context": "Their role in the movement or scene"
        }
      ],
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
  const text = result.response.text();

  const parsed = safeParseJSON<LessonOutline>(text);
  if (!parsed.chapters || !Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    throw new Error('Gemini failed to generate structured chapters in syllabus outline.');
  }

  parsed.language = language;
  return parsed;
}

/**
 * Extracts the last clean, complete sentence(s) from a text block
 * to provide context without slicing words or producing broken fragments.
 */
export function getCleanEndingSentence(rawText: string): string {
  if (!rawText) return '';
  // 1. Remove markdown headings and URLs
  const clean = rawText
    .replace(/^#+\s+[^\n]+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return '';

  // 2. Extract complete sentences using sentence terminal punctuation (. ! ?)
  const sentenceMatches = clean.match(/[^.!?]+[.!?]+(?:\s|$)/g);
  if (sentenceMatches && sentenceMatches.length > 0) {
    const lastOne = sentenceMatches[sentenceMatches.length - 1].trim();
    if (lastOne.length >= 50 || sentenceMatches.length === 1) {
      return lastOne.slice(-250);
    }
    const lastTwo = (sentenceMatches[sentenceMatches.length - 2] + ' ' + lastOne).trim();
    return lastTwo.length <= 300 ? lastTwo : lastOne;
  }

  // Fallback: take last ~30 words to avoid word truncation
  const words = clean.split(/\s+/);
  return words.slice(-30).join(' ');
}

export async function generateLessonChapter(
  episodeTitle: string,
  chapterBrief: ChapterDossier,
  previousChapterEnding: string = '',
  isFirst: boolean = false,
  isLast: boolean = false,
  language: 'en' | 'es' = 'en'
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const isSpanish = language === 'es';

  const searchQuery = encodeURIComponent(
    `${chapterBrief.featured_song.artist} ${chapterBrief.featured_song.title}`.replace(/\s+/g, '+')
  );

  const additionalArtistsList = (chapterBrief.additional_artists || [])
    .map(
      (a) =>
        `- ${a.artist}: track "${a.song_title}" (${a.context || 'scene contemporary'}). Embed as [Play "${a.song_title}" by ${a.artist} on YouTube](https://www.youtube.com/results?search_query=${encodeURIComponent(`${a.artist} ${a.song_title}`.replace(/\s+/g, '+'))})`
    )
    .join('\n');

  const cleanPreviousEnding = getCleanEndingSentence(previousChapterEnding);

  const prompt = isSpanish
    ? `Eres el narrador y especialista cultural de este podcast documental sobre música.
Episodio: '${episodeTitle}'.
Capítulo ${chapterBrief.chapter_number}: '${chapterBrief.title}'.

DIRECTRICES DE ESTILO Y TONO EDITORIAL (CRÍTICAS):
- Tono documental europeo (estilo BBC Radio 4 / Radio Clásica RNE): sobrio, reflexivo, culto, preciso y honesto.
- ESTRICTAMENTE PROHIBIDO el tono sensacionalista, efectista o "americano": cero hipérboles ("locura", "alucinante", "te volará la cabeza", "abróchate el cinturón", "increíble revolución que lo cambió todo"). Sin postureo, sin lenguaje de marketing ni falso entusiasmo "OMG".
- Rigor técnico: explica la armonía, ritmos, tímbrica e instrumentación con claridad analítica, tratando al oyente como a un adulto inteligente.

MANDATO DE CONTENIDO Y ARTISTAS:
1. Contexto histórico y social: Por qué este sonido surgió en este momento y lugar (${chapterBrief.historical_context_reasons}).
2. Protagonista central: Dedica el análisis biográfico y estilístico en profundidad a ${chapterBrief.artist_spotlight} (instrumentación, técnicas, lucha creativa y visión).
3. Teoría musical y producción: Desgrana ${chapterBrief.musical_theory_focus} con agudeza auditiva.
4. Canción principal analizada:
   Introduce y disecciona: [Play "${chapterBrief.featured_song.title}" by ${chapterBrief.featured_song.artist} on YouTube](https://www.youtube.com/results?search_query=${searchQuery})
5. AMPLITUD DE ARTISTAS Y PANORAMA MUSICAL (OBLIGATORIO):
   - No limites el capítulo a un único músico. Menciona y sitúa en el contexto a otros artistas relevantes, contemporáneos, influencias o pioneros de la escena.
${additionalArtistsList ? `   Artistas adicionales sugeridos a integrar:\n${additionalArtistsList}\n` : ''}
   - CADA ARTISTA MENCIONADO DEBE LLEVAR AL MENOS UNA REFERENCIA CONCRETA A UNA CANCIÓN CON SU ENLACE A YOUTUBE.
   - Formato exacto de cada enlace: [Play "Título de Canción" by Artista on YouTube](https://www.youtube.com/results?search_query=Artista+Cancion).
   - Incluye entre 3 y 5 canciones en total a lo largo del capítulo, integradas fluidamente en la narración.
   - REGLA DE FORMATO DE CANCIONES: Coloca cada enlace de canción en su PROPIA LÍNEA independiente entre párrafos narrativos. NUNCA incrustes el enlace a mitad de una frase o párrafo.
6. Puntos clave a cubrir:
${chapterBrief.key_talking_points.map((p) => `- ${p}`).join('\n')}

${cleanPreviousEnding ? `TRANSICIÓN DESDE EL CAPÍTULO PREVIO:
- El capítulo previo concluyó reflexionando sobre: "${cleanPreviousEnding}".
- REGLAS ESTRICTAS DE TRANSICIÓN:
  * NO repitas, cites ni hagas eco de esas palabras textuales.
  * NO comiences con puntos suspensivos ("...") ni con frases cortadas.
  * Comienza INMEDIATAMENTE debajo del título ## ${chapterBrief.title} con prosa narrativa 100% nueva, completa y fluida que abra el nuevo tema.` : ''}

Longitud objetivo: 900 a 1.200 palabras para este capítulo.
Idioma: Escribe todo el capítulo en ESPAÑOL culto, natural y fluido.

NORMAS PARA SÍNTESIS DE VOZ:
- Texto puramente narrado para ser leído en voz alta por un sintetizador de voz.
- NINGUNA acotación sonora: nada de '(Música de fondo...)', nada de '[Aplausos]', nada de '(Fade out)'.
- NINGUNA etiqueta de locutor: nada de '**Locutor:**', ni 'Narrador:'.
- Encabeza el capítulo con su título como Markdown h2: ## ${chapterBrief.title}
- ${isLast ? 'Cierra con una reflexión sobria sobre el legado duradero de este movimiento.' : 'No cierres todo el podcast aquí; concluye con un puente natural hacia el siguiente tema.'}`
    : `You are the narrator and cultural essayist of this deep-dive music documentary podcast.
Episode: '${episodeTitle}'.
Chapter ${chapterBrief.chapter_number}: '${chapterBrief.title}'.

EDITORIAL TONE & VOICE MANDATE (CRITICAL):
- Sober, measured, articulate, European documentary style (BBC Radio 4 / France Musique).
- STRICTLY FORBIDDEN: American podcast clickbait, sensationalist hype, or artificial excitement ("mind-blowing", "insane", "buckle up", "game-changer", "everything is so exciting OMG"). No marketing fluff or corporate bullshit.
- Treat musical theory and historical developments with intellectual honesty, nuance, and grounded critique.

CONTENT, ARTISTS & TRACK MANDATE:
1. Historical & cultural catalysts: Detail why this sound arose in this specific socio-cultural context (${chapterBrief.historical_context_reasons}).
2. Core Artist Spotlight: Focus in-depth critical analysis on ${chapterBrief.artist_spotlight} (craft, instruments, studio experiments, mindset).
3. Music Theory & Production: Break down ${chapterBrief.musical_theory_focus} (harmonic structures, rhythm, timbre, production).
4. Primary featured song analysis:
   Introduce and dissect [Play "${chapterBrief.featured_song.title}" by ${chapterBrief.featured_song.artist} on YouTube](https://www.youtube.com/results?search_query=${searchQuery}).
5. EXPANDED ARTIST SCENE PANORAMA (MANDATORY):
   - You MUST name-check and contextualize multiple other relevant artists from this movement (peers, predecessors, local scene players, collaborators, or rivals) to avoid a narrow "great man" narrative.
${additionalArtistsList ? `   Suggested scene artists to weave in:\n${additionalArtistsList}\n` : ''}
   - EVERY ARTIST MENTIONED MUST INCLUDE AT LEAST ONE SPECIFIC ILLUSTRATIVE SONG REFERENCE WITH A MARKDOWN YOUTUBE LINK.
   - Exact link format: [Play "Song Title" by Artist on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title).
   - Aim for 3 to 5 total song references across the chapter, woven naturally into the historical and musical prose.
   - MANDATORY SONG LINK FORMAT: Always place each featured song link on its OWN separate standalone line between narrative paragraphs. NEVER embed song links mid-sentence or mid-paragraph.
6. Cover all chapter talking points thoroughly:
${chapterBrief.key_talking_points.map((p) => `- ${p}`).join('\n')}

${cleanPreviousEnding ? `TRANSITION & PRECEDING CONTEXT:
- The preceding chapter concluded reflecting on: "${cleanPreviousEnding}".
- STRICT TRANSITION MANDATES:
  * Do NOT repeat, quote, or echo ANY of those exact words or sentences.
  * Do NOT start with an ellipsis ("...") or any sentence fragment.
  * Begin IMMEDIATELY under the '## ${chapterBrief.title}' heading with 100% fresh, complete, and articulate narrative prose introducing this new chapter.` : ''}

Target length: 900 to 1,200 words for this chapter alone. Rich, articulate, and insightful.
Language: Write strictly in polished ENGLISH.

CRITICAL SPOKEN RULES:
- Write purely spoken narration meant to be read directly aloud by a voice synthesizer.
- Absolutely NO sound directions: no '(Intro music fades in...)', no '[Applause]', no '(Drum roll)'.
- Absolutely NO speaker labels: no '**Host:**', no 'Host:', no 'Narrator:'.
- Format this chapter with its title as a Markdown h2 at the very beginning: ## ${chapterBrief.title}
- ${isLast ? 'Provide a natural, sober conclusion reflecting on the enduring legacy and ripple effects of this movement.' : 'Do NOT conclude or wrap up the entire podcast in this chapter; end with a natural bridge to the next topic.'}`;

  const result = await model.generateContent(prompt);
  let text = result.response.text().trim();

  // 1. Ensure chapter starts with ## heading
  if (!text.startsWith('## ')) {
    text = `## ${chapterBrief.title}\n\n${text}`;
  }

  // 2. Safeguard: strip any accidental leading ellipsis or sentence fragment right after ## heading
  text = text.replace(/^(##\s+[^\n]+\n+)(?:\.{2,3}|…)\s*([a-z])/i, (_, heading, firstChar) => `${heading}${firstChar.toUpperCase()}`);
  text = text.replace(/^(##\s+[^\n]+\n+)(?:\.{2,3}|…)\s*/, '$1');

  // 3. Safeguard: if the opening paragraph duplicates any part of previousChapterEnding, strip that duplicated paragraph
  if (previousChapterEnding && previousChapterEnding.length > 20) {
    const blocks = text.split(/\n\s*\n/);
    if (blocks.length > 1) {
      const firstPara = blocks[1].trim();
      const prevNorm = previousChapterEnding.toLowerCase().replace(/[^a-z0-9]/g, '');
      const firstNorm = firstPara.toLowerCase().replace(/[^a-z0-9]/g, '');

      // If the first paragraph is an echo/repeat of the previous ending, remove it
      if (firstNorm.length > 30 && (prevNorm.includes(firstNorm) || firstNorm.includes(prevNorm.slice(-60)))) {
        blocks.splice(1, 1);
        text = blocks.join('\n\n');
      }
    }
  }

  return text;
}

export async function generateFullLessonV2(
  userPrompt: string,
  onEvent?: (event: LessonStreamEvent) => Promise<void> | void,
  resumeFromChapterIndex: number = 0,
  language: 'en' | 'es' = 'en'
): Promise<{ title: string; content: string }> {
  let existingDraft = await fetchActiveLessonBuild();
  let outline: LessonOutline;

  // Detect language from draft or parameter
  const effectiveLanguage: 'en' | 'es' =
    existingDraft?.outline_json?.language || existingDraft?.language || language;

  // 1. Phase 1: Planning / Syllabus Outline
  if (existingDraft && existingDraft.outline_json && resumeFromChapterIndex > 0) {
    outline = existingDraft.outline_json;
    if (onEvent) {
      const msg = effectiveLanguage === 'es'
        ? `Reanudando el podcast "${outline.title}" desde el Capítulo ${resumeFromChapterIndex + 1}...`
        : `Resuming podcast "${outline.title}" from Chapter ${resumeFromChapterIndex + 1}...`;
      await onEvent({ type: 'status', message: msg });
      await onEvent({ type: 'outline', data: outline });
    }
  } else {
    if (onEvent) {
      const msg = effectiveLanguage === 'es'
        ? '🧠 Gemini está diseñando el guion del episodio (estructurando capítulos, seleccionando artistas y curando temas)...'
        : '🧠 Gemini is designing the episode syllabus (structuring chapters, selecting artists & curating songs)...';
      await onEvent({ type: 'status', message: msg });
    }

    // Save initial planning status to DB
    await saveActiveLessonBuild({
      topic_prompt: userPrompt,
      language: effectiveLanguage,
      status: 'planning',
      current_step: 'planning_syllabus'
    });

    outline = await planLessonCurriculum(userPrompt, effectiveLanguage);

    // Save outline to DB
    await saveActiveLessonBuild({
      topic_prompt: userPrompt,
      title: outline.title,
      language: effectiveLanguage,
      outline_json: outline,
      chapters_json: [],
      content: `# ${outline.title}\n\n${outline.intro}`,
      status: 'in_progress',
      current_step: 'syllabus_ready'
    });

    if (onEvent) {
      await onEvent({ type: 'outline', data: outline });
      const readyMsg = effectiveLanguage === 'es'
        ? `✓ Guion estructurado: "${outline.title}". Escribiendo Capítulo 1/${outline.chapters.length}...`
        : `✓ Syllabus created: "${outline.title}". Writing Chapter 1/${outline.chapters.length}...`;
      await onEvent({ type: 'status', message: readyMsg });
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
        ? getCleanEndingSentence(completedChapters[completedChapters.length - 1].text)
        : getCleanEndingSentence(outline.intro);

    if (onEvent) {
      const writingMsg = effectiveLanguage === 'es'
        ? `✍️ Gemini está redactando el Capítulo ${i + 1}/${outline.chapters.length}: "${chapterBrief.title}" (${chapterBrief.artist_spotlight.split(',')[0].slice(0, 35)})...`
        : `✍️ Gemini is writing Chapter ${i + 1}/${outline.chapters.length}: "${chapterBrief.title}" (spotlighting ${chapterBrief.artist_spotlight.split(',')[0].slice(0, 35)})...`;
      await onEvent({
        type: 'status',
        message: writingMsg,
        step: `chapter_${i + 1}`
      });
    }

    const chapterText = await generateLessonChapter(
      outline.title,
      chapterBrief,
      previousEnding,
      isFirst,
      isLast,
      effectiveLanguage
    );
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
      language: effectiveLanguage,
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
        const nextMsg = effectiveLanguage === 'es'
          ? `⚡ Capítulo ${i + 1} completado (${wordCount} palabras). Iniciando Capítulo ${i + 2}: "${outline.chapters[i + 1].title}"...`
          : `⚡ Chapter ${i + 1} received (${wordCount} words). Starting Chapter ${i + 2}: "${outline.chapters[i + 1].title}"...`;
        await onEvent({
          type: 'status',
          message: nextMsg
        });
      }
    }
  }

  // 3. Append Conclusion if present and not already concluding
  const conclusionHeading = effectiveLanguage === 'es' ? '## Conclusión' : '## Conclusion';
  if (outline.conclusion && !accumulatedContent.includes(conclusionHeading)) {
    const conclusionMarkdown = `${conclusionHeading}\n\n${outline.conclusion}`;
    accumulatedContent += `\n\n${conclusionMarkdown}`;
  }

  const totalWords = accumulatedContent.split(/\s+/).filter(Boolean).length;

  // Finalize active build state
  await saveActiveLessonBuild({
    topic_prompt: userPrompt,
    title: outline.title,
    language: effectiveLanguage,
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

export async function generateLessonGemini(
  userPrompt: string,
  language: 'en' | 'es' = 'en'
): Promise<{ title: string; content: string }> {
  // Uses V2 multi-step generation pipeline
  return generateFullLessonV2(userPrompt, undefined, 0, language);
}

export async function refineLessonGemini(
  originalPrompt: string,
  previousLesson: string,
  userSuggestion: string,
  language: 'en' | 'es' = 'en'
): Promise<{ title: string; content: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const rawModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').replace(/^["']|["']$/g, '').trim();
  const modelName = rawModel === 'gemini-2.0-flash' ? 'gemini-2.5-flash' : rawModel;
  const model = genAI.getGenerativeModel({ model: modelName });

  const isSpanish = language === 'es' || /\b(el|la|los|las|de|en|un|una|por|para|música)\b/i.test(previousLesson.slice(0, 300));

  const prompt = isSpanish
    ? `Eres un experto musicólogo y documentalista cultural de prestigio (estilo BBC Radio 4 / Radio Clásica RNE). Ayudaste al usuario con el tema original '${originalPrompt}', devolviste '${previousLesson}', y ahora el usuario pide: '${userSuggestion}'.

Devuelve el podcast modificado manteniendo:
- Título conciso y sobrio de máximo 5-8 palabras, sin adornos ni clickbait (# Título).
- Tono reflexivo, culto, honesto y equilibrado, sin hipérboles ni lenguaje de marketing ("sin postureo", sin frases como "te volará la cabeza" o "increíble locura").
- Enlaces a YouTube para cada canción/artista mencionado, formateados como [Play "Título de Canción" by Artista on YouTube](https://www.youtube.com/results?search_query=Artista+Cancion).
- Redacción estrictamente en ESPAÑOL culto.

Reglas estrictas de locución:
- Texto puramente narrado para sintetizador de voz.
- Cero acotaciones sonoras ('(música)', '[aplausos]').
- Cero etiquetas de locutor ('**Locutor:**').`
    : `You are an elite musicologist and cultural documentary essayist (in the tradition of BBC Radio 4 / France Musique). You assisted the user with '${originalPrompt}', provided '${previousLesson}', and now the user wants to '${userSuggestion}'.

Return the modified podcast, maintaining:
- A sober, direct title of maximum 5-8 words, strictly no fluff or clickbait (# Title).
- A balanced, European documentary tone: sober, measured, analytical, zero hype or American sensationalist fluff ("no bullshit", no "mind-blowing", "insane", or "OMG").
- Clear structure with multiple artists contextualized and inline YouTube song links for each artist mentioned, formatted as [Play "Song Title" by Artist on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title).
- Polished, articulate English prose.

Spoken text rules:
- Pure spoken narration meant to be read directly aloud.
- No sound directions ('(music)', '[applause]').
- No speaker labels ('**Host:**').`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  let title = originalPrompt.slice(0, 60);
  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim().replace(/\*+/g, '').replace(/^["']|["']$/g, '');
  }

  return { title, content: text };
}

export function pcmToWav(
  pcmBuffer: Buffer,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const wavHeader = Buffer.alloc(44);

  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // 1 = PCM
  wavHeader.writeUInt16LE(numChannels, 22);
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(byteRate, 28);
  wavHeader.writeUInt16LE(blockAlign, 32);
  wavHeader.writeUInt16LE(bitsPerSample, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([wavHeader, pcmBuffer]);
}

export function hashText(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex').slice(0, 12);
}

export function sanitizeSpokenText(text: string): string {
  return sanitizeTextForSpeech(text);
}

export async function generateSpeechSegment(
  rawText: string,
  voiceName: string = 'Puck',
  language?: 'en' | 'es'
): Promise<{ wavBuffer: Buffer; durationSeconds: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in .env.local');
  }

  const cleanText = sanitizeSpokenText(rawText);
  if (!cleanText || cleanText.length < 2) {
    const silentPcm = Buffer.alloc(2400); // 0.05s silence
    return { wavBuffer: pcmToWav(silentPcm), durationSeconds: 0.1 };
  }

  // Detect Spanish either from parameter or text vocabulary to ensure Spanish from Spain accent (es-ES)
  const isSpanish =
    language === 'es' ||
    /\b(el|la|los|las|de|en|un|una|por|para|con|este|esta|canción|música|del|al|fue|eran|había|años|canciones)\b/i.test(cleanText);
  const languageCode = isSpanish ? 'es-ES' : 'en-US';

  const modelsToTry = [
    'gemini-2.5-flash-preview-tts',
    'gemini-3.8-flash-tts',
    'gemini-3.1-flash-tts-preview'
  ];

  let lastError: any = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const payload = {
        contents: [
          {
            parts: [{ text: cleanText }]
          }
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName || 'Puck'
              }
            },
            languageCode: languageCode
          }
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const rawErrMsg = errJson.error?.message || `TTS call failed with status ${res.status}`;
        const retryAfterHeader = res.headers.get('retry-after');

        if (res.status === 429 || isQuotaError(res.status, rawErrMsg)) {
          const waitTime = extractQuotaWaitTime(rawErrMsg) || (retryAfterHeader ? `${retryAfterHeader} seconds` : null);
          const friendlyMsg = waitTime
            ? `Gemini quota exceeded. Please retry in ${waitTime}.`
            : `Gemini quota exceeded: ${rawErrMsg}`;
          throw new GeminiQuotaExceededError(friendlyMsg, waitTime, rawErrMsg);
        }

        throw new Error(rawErrMsg);
      }

      const data = await res.json();
      const part = data.candidates?.[0]?.content?.parts?.[0];
      if (part?.inlineData?.data) {
        const pcmBuffer = Buffer.from(part.inlineData.data, 'base64');
        const wavBuffer = pcmToWav(pcmBuffer, 24000, 1, 16);
        const durationSeconds = Number((pcmBuffer.length / 48000).toFixed(2));
        return { wavBuffer, durationSeconds };
      }
    } catch (err: any) {
      lastError = err;
      if (err.isQuota || err.name === 'GeminiQuotaExceededError' || isQuotaError(err.message)) {
        // Halt immediately on quota/rate limit error - fallback models share the same project quota
        throw err;
      }
      console.warn(`Failed TTS with model ${model}, trying fallback:`, err);
    }
  }

  throw new Error(`All Gemini TTS models failed: ${lastError?.message || 'Unknown error'}`);
}

