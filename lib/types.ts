export type ActionType = 'INTERESTED' | 'GOING' | 'COMMENT' | 'REMOVED';

export interface Activity {
  id: string;
  concert_id: string;
  user_name: string;
  action_type: ActionType;
  comment_text?: string | null;
  created_at: string;
}

export interface Concert {
  id: string;
  band_name: string;
  venue_name: string;
  date: string; // ISO String
  url?: string | null;
  youtube_urls: string[];
  toni_comment?: string | null;
  created_at: string;
  activities?: Activity[];
}

export interface ScrapeResult {
  band_name: string;
  venue_name: string;
  date: string; // ISO YYYY-MM-DD or ISO timestamp
  confidence?: string;
  raw_title?: string;
}

export interface DiscoverUrl {
  id: string;
  url: string;
  name?: string | null;
  new_extracted_json?: Record<string, unknown>[] | null;
  last_extracted_json?: Record<string, unknown>[] | null;
  last_scraped_at?: string | null;
  created_at: string;
}

export interface DiscoverPreferences {
  id: string;
  content: string;
  updated_at: string;
}

export type DiscoverEventStatus = 'candidate' | 'interested' | 'rejected';

export interface DiscoverEvent {
  id: string;
  event_name: string;
  venue_name?: string | null;
  date?: string | null; // ISO String
  url?: string | null;
  status: DiscoverEventStatus;
  rejection_reason?: string | null;
  match_reason?: string | null;
  source_url?: string | null;
  created_at: string;
}

export interface DiscoverCrawledSublink {
  id: string;
  source_url: string;
  sublink_url: string;
  crawled_at: string;
}

export interface AudioSegment {
  segment_id: number;
  type: 'heading' | 'paragraph';
  text_hash: string;
  audio_url: string;
  duration_seconds?: number;
  created_at: string;
}

export interface Lesson {
  id: string;
  title: string;
  topic_prompt: string;
  content: string;
  created_at: string;
  audio_status?: 'none' | 'in_progress' | 'paused' | 'ready';
  audio_voice?: string;
  audio_segments?: AudioSegment[];
}


export interface ChapterDossier {
  chapter_number: number;
  title: string;
  historical_context_reasons: string;
  artist_spotlight: string;
  musical_theory_focus: string;
  featured_song: {
    title: string;
    artist: string;
    year?: string;
    narrative_context?: string;
  };
  key_talking_points: string[];
}

export interface LessonOutline {
  title: string;
  intro: string;
  chapters: ChapterDossier[];
  conclusion: string;
}

export interface CompletedChapter {
  chapter_number: number;
  title: string;
  text: string;
  wordCount: number;
}

export interface ActiveLessonBuild {
  id: string;
  topic_prompt: string;
  title: string | null;
  outline_json: LessonOutline | null;
  chapters_json: CompletedChapter[];
  content: string;
  status: 'planning' | 'in_progress' | 'completed' | 'paused' | 'error';
  current_step?: string | null;
  updated_at: string;
}

export type LessonStreamEvent =
  | { type: 'status'; message: string; step?: string }
  | { type: 'outline'; data: LessonOutline }
  | { type: 'chapter'; chapterIndex: number; chapter: CompletedChapter; accumulatedContent: string }
  | { type: 'complete'; lesson: { title: string; content: string; totalWords: number } }
  | { type: 'error'; error: string };

export type AudioStreamEvent =
  | { type: 'status'; message: string; completedCount: number; totalCount: number }
  | { type: 'segment_ready'; segment: AudioSegment; completedCount: number; totalCount: number }
  | { type: 'complete'; lessonId: string; totalSegments: number; audioSegments: AudioSegment[] }
  | { type: 'error'; error: string; isQuota?: boolean; retryAfter?: string };

/**
 * Parses duration strings returned in Google Gemini rate-limit / quota errors
 * (e.g., "Please retry in 38.202879563s.", "Please retry in 17h14.442568019s.")
 * into human-readable formatted wait times.
 */
export function extractQuotaWaitTime(errorMessage: string | undefined | null): string | null {
  if (!errorMessage || typeof errorMessage !== 'string') return null;

  const match = errorMessage.match(/(?:please\s+retry\s+in|retry\s+after|retry\s+in)\s+([0-9a-zA-Z\.]+)/i);
  if (!match || !match[1]) return null;
  const raw = match[1].trim().replace(/\.$/, '');

  // If raw is just an integer (e.g., seconds from Retry-After)
  if (/^\d+$/.test(raw)) {
    const totalSecs = parseInt(raw, 10);
    if (totalSecs < 60) return `${totalSecs} second${totalSecs !== 1 ? 's' : ''}`;
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return `${m} minute${m !== 1 ? 's' : ''}${s > 0 ? `, ${s} second${s !== 1 ? 's' : ''}` : ''}`;
  }

  let remaining = raw;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  const h = remaining.match(/^(\d+)h/i);
  if (h) {
    hours = parseInt(h[1], 10);
    remaining = remaining.slice(h[0].length);
  }
  const m = remaining.match(/^(\d+)m(?!s)/i);
  if (m) {
    minutes = parseInt(m[1], 10);
    remaining = remaining.slice(m[0].length);
  }
  const s = remaining.match(/^([\d\.]+)s(?:ec(?:onds?)?)?/i);
  if (s) {
    seconds = parseFloat(s[1]);
    remaining = remaining.slice(s[0].length);
  }

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  if (seconds > 0) {
    const secRounded = hours > 0 || minutes > 0 ? Math.round(seconds) : Math.ceil(seconds);
    if (secRounded > 0) {
      parts.push(`${secRounded} second${secRounded > 1 ? 's' : ''}`);
    }
  }

  if (parts.length > 0) {
    return parts.join(', ');
  }
  return raw;
}

/**
 * Checks whether an HTTP status or error message represents a Gemini quota or rate limit exhaustion.
 */
export function isQuotaError(messageOrStatus: string | number | undefined | null, messageText?: string): boolean {
  if (typeof messageOrStatus === 'number' && messageOrStatus === 429) return true;
  const combined = `${messageOrStatus || ''} ${messageText || ''}`.toLowerCase();
  return (
    combined.includes('quota') ||
    combined.includes('resource_exhausted') ||
    combined.includes('rate limit') ||
    combined.includes('rate_limit') ||
    combined.includes('free_tier_requests') ||
    combined.includes('please retry in') ||
    combined.includes('retry in')
  );
}

export class GeminiQuotaExceededError extends Error {
  isQuota: boolean = true;
  retryAfter: string | null;
  rawWaitTime: string | null;

  constructor(message: string, retryAfter: string | null = null, rawWaitTime: string | null = null) {
    super(message);
    this.name = 'GeminiQuotaExceededError';
    this.isQuota = true;
    this.retryAfter = retryAfter;
    this.rawWaitTime = rawWaitTime;
  }
}




