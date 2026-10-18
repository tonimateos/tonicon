-- Tonicon Database Schema for Supabase

-- 1. Concerts Table
CREATE TABLE IF NOT EXISTS public.concerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    band_name TEXT NOT NULL,
    venue_name TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    url TEXT,
    youtube_urls JSONB DEFAULT '[]'::jsonb,
    toni_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Activity / Reactions / Comments Table
CREATE TABLE IF NOT EXISTS public.activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    concert_id UUID NOT NULL REFERENCES public.concerts(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('INTERESTED', 'GOING', 'COMMENT', 'REMOVED')),
    comment_text TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_concerts_date ON public.concerts (date ASC);
CREATE INDEX IF NOT EXISTS idx_activity_concert_id ON public.activity (concert_id, created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.concerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity ENABLE ROW LEVEL SECURITY;

-- Allow public read/write access (for lightweight friend RSVPs and API interaction)
CREATE POLICY "Allow public read access to concerts" ON public.concerts FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to concerts" ON public.concerts FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update access to concerts" ON public.concerts FOR UPDATE USING (true);

CREATE POLICY "Allow public read access to activity" ON public.activity FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to activity" ON public.activity FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete access to activity" ON public.activity FOR DELETE USING (true);

-- 3. Discover Sources Table
CREATE TABLE IF NOT EXISTS public.discover_urls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    name TEXT,
    last_extracted_json JSONB DEFAULT '[]'::jsonb,
    new_extracted_json JSONB DEFAULT '[]'::jsonb,
    last_scraped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.discover_urls ADD COLUMN IF NOT EXISTS last_extracted_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.discover_urls ADD COLUMN IF NOT EXISTS new_extracted_json JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.discover_urls ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;

-- 4. Discover Preferences Table
CREATE TABLE IF NOT EXISTS public.discover_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Discover Events Table
CREATE TABLE IF NOT EXISTS public.discover_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_name TEXT NOT NULL,
    venue_name TEXT,
    date TIMESTAMPTZ,
    url TEXT,
    status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'interested', 'rejected')),
    rejection_reason TEXT,
    match_reason TEXT,
    source_url TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.discover_events ADD COLUMN IF NOT EXISTS match_reason TEXT;

-- Indexes for discover events
CREATE INDEX IF NOT EXISTS idx_discover_events_status ON public.discover_events (status, date ASC);

-- Enable RLS for Discover tables
ALTER TABLE public.discover_urls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discover_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discover_events ENABLE ROW LEVEL SECURITY;

-- Allow public access to Discover tables
CREATE POLICY "Allow public all access to discover_urls" ON public.discover_urls FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all access to discover_preferences" ON public.discover_preferences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public all access to discover_events" ON public.discover_events FOR ALL USING (true) WITH CHECK (true);

-- 6. Discover Crawled Sublinks Table (for crawler deduplication)
CREATE TABLE IF NOT EXISTS public.discover_crawled_sublinks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_url TEXT NOT NULL,
    sublink_url TEXT NOT NULL,
    crawled_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(source_url, sublink_url)
);

CREATE INDEX IF NOT EXISTS idx_crawled_sublinks_source ON public.discover_crawled_sublinks (source_url);
ALTER TABLE public.discover_crawled_sublinks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all access to discover_crawled_sublinks" ON public.discover_crawled_sublinks FOR ALL USING (true) WITH CHECK (true);
-- 7. Lessons Table
CREATE TABLE IF NOT EXISTS public.lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    topic_prompt TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lessons_created_at ON public.lessons (created_at DESC);
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to lessons" ON public.lessons FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to lessons" ON public.lessons FOR INSERT WITH CHECK (true);

-- 8. Active Lesson Build Table (for resilient multi-step generation & auto-resume)
CREATE TABLE IF NOT EXISTS public.active_lesson_build (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_prompt TEXT NOT NULL,
    title TEXT,
    outline_json JSONB,
    chapters_json JSONB DEFAULT '[]'::jsonb,
    content TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'in_progress',
    current_step TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.active_lesson_build ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all access to active_lesson_build" ON public.active_lesson_build FOR ALL USING (true) WITH CHECK (true);

-- 9. Lesson v3: Paragraph-Level Studio Audio Columns
ALTER TABLE public.lessons 
ADD COLUMN IF NOT EXISTS audio_status TEXT NOT NULL DEFAULT 'none',
ADD COLUMN IF NOT EXISTS audio_voice TEXT DEFAULT 'default',
ADD COLUMN IF NOT EXISTS audio_segments JSONB DEFAULT '[]'::jsonb;

-- 10. Language Preference Column (English / Spanish)
ALTER TABLE public.lessons
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

ALTER TABLE public.active_lesson_build
ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'en';

-- Allow update access for lessons audio rendering
DROP POLICY IF EXISTS "Allow public update access to lessons" ON public.lessons;
CREATE POLICY "Allow public update access to lessons" ON public.lessons FOR UPDATE USING (true) WITH CHECK (true);


