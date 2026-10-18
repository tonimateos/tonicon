import { PlayerSegment } from './types';

/**
 * Sanitizes text for visual display in the podcast player.
 * Removes script stage directions/cues without destroying legitimate musical prose,
 * terms (like beat, riff, sound, guitar), or markdown links.
 */
export function cleanVisualText(raw: string): string {
  let cleaned = raw
    // Remove sound cues like (Intro music fades in...) or (Música de fondo...)
    .replace(/\(\s*(?:music|intro\s+music|outro\s+music|sound\s+effect|applause|cheers?|fade\s+(?:in|out)|música|aplausos|efecto\s+de\s+sonido)\b[^)]*\)/gi, '')
    // Remove bracketed cues like [Music fades] or [Applause], but NEVER touch markdown links [text](url)
    .replace(/\[\s*(?:music|intro\s+music|outro\s+music|sound\s+effect|applause|cheers?|fade\s+(?:in|out)|música|aplausos|efecto\s+de\s+sonido)\b[^\]]*\](?!\()/gi, '')
    // Remove speaker labels like **Host:** or Host: or Narrator:
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter|Locutor|Narrador|Presentador)(?:\*\*|\*|\])?:\s*/gi, '')
    .trim();

  // Strip accidental leading ellipses at start of paragraphs (e.g. "...music was evolving" -> "Music was evolving")
  cleaned = cleaned.replace(/^(?:\.{2,3}|…)\s*([a-z])/i, (_, firstChar) => firstChar.toUpperCase());
  cleaned = cleaned.replace(/^(?:\.{2,3}|…)\s*/, '');

  return cleaned.trim();
}

/**
 * Sanitizes text for speech synthesis (TTS).
 * Converts song links to spoken names, strips URLs, sound cues, and formatting tokens.
 */
export function sanitizeTextForSpeech(raw: string): string {
  let text = raw
    // Remove sound cues
    .replace(/\(\s*(?:music|intro\s+music|outro\s+music|sound\s+effect|applause|cheers?|fade\s+(?:in|out)|música|aplausos|efecto\s+de\s+sonido)\b[^)]*\)/gi, '')
    .replace(/\[\s*(?:music|intro\s+music|outro\s+music|sound\s+effect|applause|cheers?|fade\s+(?:in|out)|música|aplausos|efecto\s+de\s+sonido)\b[^\]]*\](?!\()/gi, '')
    // Remove speaker labels
    .replace(/(?:^|\n)\s*(?:\*\*|\*|\[)?(?:Host|Narrator|Speaker|Announcer|Presenter|Locutor|Narrador|Presentador)(?:\*\*|\*|\])?:\s*/gi, '')
    // Format markdown song links into spoken track names: [Play "Title" by Artist on YouTube](url) -> "Title" by Artist
    .replace(/\[(?:Play|Escuchar|Reproducir)?\s*(.*?)(?:\s+(?:on|en)\s+YouTube)?\]\(https?:\/\/[^\s)]+\)/gi, '$1')
    .replace(/\[(.*?)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip accidental leading ellipses
  text = text.replace(/^(?:\.{2,3}|…)\s*([a-z])/i, (_, firstChar) => firstChar.toUpperCase());
  text = text.replace(/^(?:\.{2,3}|…)\s*/, '');

  return text.trim();
}

/**
 * Extracts YouTube URL and clean song label from markdown link or raw URL.
 */
export function extractYouTubeInfo(text: string): { label: string; url: string } | null {
  const match =
    text.match(/\[(.*?)(?:(?:on|en)\s+YouTube)?\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)\)/i) ||
    text.match(/(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)/i);

  if (!match) return null;

  const url = match[2] || match[1];
  const rawLabel = match[1] || '';
  const songLabel =
    rawLabel
      .replace(/^(?:Play|Escuchar|Reproducir)\s+/i, '')
      .replace(/\s+(?:on|en)\s+YouTube$/i, '')
      .replace(/[*"'`]/g, '')
      .trim() || 'Featured Track';

  return { label: songLabel, url };
}

/**
 * Converts YouTube URL to privacy-friendly embed URL.
 */
export function getEmbedUrl(youtubeUrl: string): string {
  const queryMatch = youtubeUrl.match(/[?&]search_query=([^&#]+)/);
  if (queryMatch && queryMatch[1]) {
    return `https://www.youtube-nocookie.com/embed?listType=search&list=${queryMatch[1]}&autoplay=1`;
  }

  const idMatch = youtubeUrl.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]{11})/);
  if (idMatch && idMatch[1]) {
    return `https://www.youtube-nocookie.com/embed/${idMatch[1]}?autoplay=1`;
  }

  return youtubeUrl;
}

const YOUTUBE_REGEX =
  /\[(.*?)(?:(?:on|en)\s+YouTube)?\]\((https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+)\)|https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+/i;

/**
 * Parses markdown podcast content into structured player segments.
 * Correctly preserves full narrative paragraphs and assigns aligned spokenId numbers.
 */
export function parseLessonSegments(content: string): PlayerSegment[] {
  if (!content) return [];

  // Normalize line breaks and ensure headings have distinct block boundaries
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/^(#{1,3}\s+[^\n]+)$/gm, '\n\n$1\n\n');

  const rawBlocks = normalized.split(/\n\s*\n/);
  const rawSegments: PlayerSegment[] = [];
  let currentId = 0;
  let spokenIdCounter = 0;

  for (let i = 0; i < rawBlocks.length; i++) {
    const block = rawBlocks[i].trim();
    if (!block) continue;

    // Skip top-level episode title (# Title) since it is rendered in hero header
    if (block.startsWith('# ') && !block.startsWith('## ')) {
      continue;
    }

    // Markdown Heading: ## or ###
    if (block.startsWith('## ') || block.startsWith('### ')) {
      const headingText = block.replace(/^#{2,3}\s+/, '').replace(/\*\*/g, '').trim();
      if (headingText) {
        rawSegments.push({
          id: currentId++,
          spokenId: spokenIdCounter++,
          type: 'heading',
          title: headingText,
          text: headingText,
          rawSpeechText: sanitizeTextForSpeech(headingText)
        });
      }
      continue;
    }

    // Check if the block is solely a standalone YouTube link
    const ytMatch = block.match(YOUTUBE_REGEX);
    if (ytMatch) {
      const ytText = ytMatch[0].trim();
      const isStandalone = block === ytText;

      if (isStandalone) {
        const ytInfo = extractYouTubeInfo(block);
        if (ytInfo) {
          rawSegments.push({
            id: currentId++,
            type: 'inline_song',
            text: block,
            songTitle: ytInfo.label,
            youtubeUrl: ytInfo.url,
            embedUrl: getEmbedUrl(ytInfo.url),
            rawSpeechText: ''
          });
        }
        continue;
      }

      // If the block contains narrative text with an embedded YouTube link,
      // split it so narrative text is never dropped or cut!
      const beforeText = block.slice(0, ytMatch.index).trim();
      const afterText = block.slice((ytMatch.index || 0) + ytText.length).trim();

      if (beforeText) {
        const singleBefore = beforeText.replace(/\s*\n\s*/g, ' ').trim();
        const cleanVis = cleanVisualText(singleBefore);
        const speech = sanitizeTextForSpeech(singleBefore);
        if (cleanVis.length > 0 && speech.length > 0) {
          rawSegments.push({
            id: currentId++,
            spokenId: spokenIdCounter++,
            type: 'paragraph',
            text: cleanVis,
            rawSpeechText: speech
          });
        }
      }

      const ytInfo = extractYouTubeInfo(ytText);
      if (ytInfo) {
        rawSegments.push({
          id: currentId++,
          type: 'inline_song',
          text: ytText,
          songTitle: ytInfo.label,
          youtubeUrl: ytInfo.url,
          embedUrl: getEmbedUrl(ytInfo.url),
          rawSpeechText: ''
        });
      }

      if (afterText) {
        const singleAfter = afterText.replace(/\s*\n\s*/g, ' ').trim();
        const cleanVis = cleanVisualText(singleAfter);
        const speech = sanitizeTextForSpeech(singleAfter);
        if (cleanVis.length > 0 && speech.length > 0) {
          rawSegments.push({
            id: currentId++,
            spokenId: spokenIdCounter++,
            type: 'paragraph',
            text: cleanVis,
            rawSpeechText: speech
          });
        }
      }
      continue;
    }

    // Standard Narrative Paragraph:
    // Join soft-wrapped lines into a continuous paragraph string
    const paragraphText = block.replace(/\s*\n\s*/g, ' ').trim();
    const cleanVisual = cleanVisualText(paragraphText);
    const speechText = sanitizeTextForSpeech(paragraphText);

    if (cleanVisual.length > 0 && speechText.length > 0) {
      rawSegments.push({
        id: currentId++,
        spokenId: spokenIdCounter++,
        type: 'paragraph',
        text: cleanVisual,
        rawSpeechText: speechText
      });
    }
  }

  // Deduplicate any accidental bridging repeats right after headings (e.g. "...ectually")
  return deduplicateEchoSegments(rawSegments);
}

/**
 * Removes accidental bridging echo paragraphs right after headings
 * (where Gemini repeated the ending of the previous chapter at the start of the next).
 */
function deduplicateEchoSegments(segments: PlayerSegment[]): PlayerSegment[] {
  const result: PlayerSegment[] = [];

  for (let i = 0; i < segments.length; i++) {
    const current = segments[i];

    // Check if this is a paragraph immediately following a heading
    if (current.type === 'paragraph' && i > 0 && segments[i - 1].type === 'heading') {
      // Find the last paragraph before the heading
      let prevPara: PlayerSegment | null = null;
      for (let j = i - 2; j >= 0; j--) {
        if (segments[j].type === 'paragraph') {
          prevPara = segments[j];
          break;
        }
      }

      if (prevPara) {
        const prevClean = prevPara.text.toLowerCase().replace(/[^a-z0-9]/g, '');
        const currClean = current.text.toLowerCase().replace(/[^a-z0-9]/g, '');

        // If the current paragraph is essentially an echo/repetition of the previous paragraph
        if (
          currClean.length >= 40 &&
          (prevClean.includes(currClean) ||
            currClean.includes(prevClean) ||
            (prevClean.slice(-80).length >= 40 && currClean.startsWith(prevClean.slice(-80))) ||
            (currClean.slice(0, 80).length >= 40 && prevClean.endsWith(currClean.slice(0, 80))))
        ) {
          // Skip the duplicated echo paragraph!
          continue;
        }
      }
    }

    result.push(current);
  }

  // Re-index UI IDs and spokenIds continuously
  let newCurrentId = 0;
  let newSpokenId = 0;
  return result.map((seg) => {
    if (seg.type === 'heading' || seg.type === 'paragraph') {
      return {
        ...seg,
        id: newCurrentId++,
        spokenId: newSpokenId++
      };
    }
    return {
      ...seg,
      id: newCurrentId++
    };
  });
}
