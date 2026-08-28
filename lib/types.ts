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
  source_url?: string | null;
  created_at: string;
}

