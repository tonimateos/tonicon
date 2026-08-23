import { createClient } from '@supabase/supabase-js';
import { Concert, Activity, ActionType } from './types';

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
