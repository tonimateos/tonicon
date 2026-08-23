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
