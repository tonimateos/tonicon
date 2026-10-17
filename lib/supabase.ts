import { createClient } from '@supabase/supabase-js';
import { Concert, Activity, ActionType, Lesson } from './types';
import fs from 'fs';
import path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('Warning: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchAllConcerts(): Promise<Concert[]> {
  const { data: concertsData, error: concertsError } = await supabase
    .from('concerts')
    .select('*')
    .order('date', { ascending: true });

  if (concertsError) {
    console.error('Error fetching concerts from Supabase:', concertsError);
    throw new Error(concertsError.message || 'Failed to fetch concerts from Supabase.');
  }

  const { data: activitiesData, error: activitiesError } = await supabase
    .from('activity')
    .select('*')
    .order('created_at', { ascending: true });

  if (activitiesError) {
    console.error('Error fetching activity from Supabase:', activitiesError);
  }

  const activitiesMap = new Map<string, Activity[]>();
  (activitiesData || []).forEach((act: Activity) => {
    if (!activitiesMap.has(act.concert_id)) {
      activitiesMap.set(act.concert_id, []);
    }
    activitiesMap.get(act.concert_id)!.push(act);
  });

  return (concertsData || []).map((c: Concert) => ({
    ...c,
    youtube_urls: Array.isArray(c.youtube_urls) ? c.youtube_urls : [],
    activities: activitiesMap.get(c.id) || []
  }));
}

export async function createConcert(concertData: Omit<Concert, 'id' | 'created_at' | 'activities'>): Promise<Concert> {
  const { data, error } = await supabase
    .from('concerts')
    .insert([{
      band_name: concertData.band_name,
      venue_name: concertData.venue_name,
      date: concertData.date,
      url: concertData.url || null,
      youtube_urls: concertData.youtube_urls || [],
      toni_comment: concertData.toni_comment || null
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating concert in Supabase:', error);
    throw new Error(error.message || 'Failed to insert concert into Supabase database.');
  }

  return {
    ...data,
    youtube_urls: Array.isArray(data.youtube_urls) ? data.youtube_urls : [],
    activities: []
  };
}

export async function updateConcert(
  id: string,
  concertData: Partial<Omit<Concert, 'id' | 'created_at' | 'activities'>>
): Promise<Concert> {
  const { data, error } = await supabase
    .from('concerts')
    .update({
      band_name: concertData.band_name,
      venue_name: concertData.venue_name,
      date: concertData.date,
      url: concertData.url !== undefined ? concertData.url : null,
      youtube_urls: concertData.youtube_urls || [],
      toni_comment: concertData.toni_comment !== undefined ? concertData.toni_comment : null
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating concert in Supabase:', error);
    throw new Error(error.message || 'Failed to update concert in Supabase database.');
  }

  return {
    ...data,
    youtube_urls: Array.isArray(data.youtube_urls) ? data.youtube_urls : []
  };
}

export async function addOrUpdateActivity(
  concertId: string,
  userName: string,
  actionType: ActionType,
  commentText?: string
): Promise<Activity> {
  const { data, error } = await supabase
    .from('activity')
    .insert([{
      concert_id: concertId,
      user_name: userName.trim(),
      action_type: actionType,
      comment_text: commentText ? commentText.trim() : null
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating activity in Supabase:', error);
    throw new Error(error.message || 'Failed to insert activity into Supabase database.');
  }

  return data;
}

const LOCAL_LESSONS_FILE = path.join(process.cwd(), 'data', 'lessons.json');

function getLocalLessons(): Lesson[] {
  try {
    if (fs.existsSync(LOCAL_LESSONS_FILE)) {
      const raw = fs.readFileSync(LOCAL_LESSONS_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Error reading local lessons file:', e);
  }
  return [];
}

function saveLocalLesson(lesson: Lesson): void {
  try {
    const dir = path.dirname(LOCAL_LESSONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = getLocalLessons();
    current.unshift(lesson);
    fs.writeFileSync(LOCAL_LESSONS_FILE, JSON.stringify(current, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving local lesson:', e);
  }
}

export async function fetchAllLessons(): Promise<Lesson[]> {
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      return data;
    }
    if (error && error.code === 'PGRST205') {
      console.warn('public.lessons table does not exist in Supabase yet. Using local storage fallback.');
      return getLocalLessons();
    }
    if (error) {
      console.error('Error fetching lessons from Supabase:', error);
    }
  } catch (err) {
    console.warn('Supabase fetchAllLessons error, falling back to local storage:', err);
  }
  return getLocalLessons();
}

export async function createLesson(lessonData: {
  title: string;
  topic_prompt: string;
  content: string;
}): Promise<Lesson> {
  const newLesson: Lesson = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `lesson-${Date.now()}`,
    title: lessonData.title,
    topic_prompt: lessonData.topic_prompt,
    content: lessonData.content,
    created_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('lessons')
      .insert([{
        title: lessonData.title,
        topic_prompt: lessonData.topic_prompt,
        content: lessonData.content
      }])
      .select()
      .single();

    if (!error && data) {
      return data;
    }

    if (error && error.code === 'PGRST205') {
      console.warn('public.lessons table does not exist in Supabase yet. Saved to local storage fallback.');
      saveLocalLesson(newLesson);
      return newLesson;
    }

    if (error) {
      console.error('Error creating lesson in Supabase, saving locally:', error);
      saveLocalLesson(newLesson);
      return newLesson;
    }
  } catch (err) {
    console.warn('Error connecting to Supabase for createLesson, saving locally:', err);
    saveLocalLesson(newLesson);
    return newLesson;
  }

  saveLocalLesson(newLesson);
  return newLesson;
}
