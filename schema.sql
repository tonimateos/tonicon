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
