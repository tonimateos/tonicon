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

export interface Lesson {
  id: string;
  title: string;
  topic_prompt: string;
  content: string;
  created_at: string;
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


