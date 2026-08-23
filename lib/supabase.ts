import { createClient } from '@supabase/supabase-js';
import { Concert, Activity, ActionType } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Initial mock data for offline / fallback mode
const initialMockConcerts: Concert[] = [
  {
    id: 'mock-concert-1',
    band_name: 'The National',
    venue_name: 'Olympia Theatre, Dublin',
    date: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(), // 2 weeks from now
    url: 'https://www.ticketmaster.ie',
    youtube_urls: [
      'https://www.youtube.com/watch?v=yIWmruQOBu4',
      'https://www.youtube.com/watch?v=1SO_RBbMvN0'
    ],
    toni_comment: 'Super excited for this one! Standing tickets near the front.',
    created_at: new Date().toISOString(),
    activities: [
      {
        id: 'act-1',
        concert_id: 'mock-concert-1',
        user_name: 'Alex',
        action_type: 'GOING',
        comment_text: 'Count me in! Already got my ticket.',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString()
      },
      {
        id: 'act-2',
        concert_id: 'mock-concert-1',
        user_name: 'Maria',
        action_type: 'INTERESTED',
        comment_text: 'Might join if work allows!',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString()
      }
    ]
  },
  {
    id: 'mock-concert-2',
    band_name: 'Fontaines D.C.',
    venue_name: 'Alexandra Palace, London',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // 1 month ago
    url: 'https://www.dice.fm',
    youtube_urls: [
      'https://www.youtube.com/watch?v=8Vz1l4e4444'
    ],
    toni_comment: 'Awesome gig last month!',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 40).toISOString(),
    activities: [
      {
        id: 'act-3',
        concert_id: 'mock-concert-2',
        user_name: 'Sam',
        action_type: 'GOING',
        created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 35).toISOString()
      }
    ]
  }
];

let mockConcertsStore: Concert[] = [...initialMockConcerts];

export async function fetchAllConcerts(): Promise<Concert[]> {
  if (supabase) {
    try {
      const { data: concertsData, error: concertsError } = await supabase
        .from('concerts')
        .select('*')
        .order('date', { ascending: true });

      if (concertsError) {
        console.error('Supabase fetch error, using fallback mock store:', concertsError);
        return mockConcertsStore;
      }

      const { data: activitiesData, error: activitiesError } = await supabase
        .from('activity')
        .select('*')
        .order('created_at', { ascending: true });

      if (activitiesError) {
        console.error('Supabase activity fetch error:', activitiesError);
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
    } catch (err) {
      console.error('Failed to query Supabase, using mock store:', err);
      return mockConcertsStore;
    }
  }

  return mockConcertsStore;
}

export async function createConcert(concertData: Omit<Concert, 'id' | 'created_at' | 'activities'>): Promise<Concert> {
  const newConcert: Concert = {
    ...concertData,
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `concert-${Date.now()}`,
    created_at: new Date().toISOString(),
    activities: []
  };

  if (supabase) {
    try {
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
        console.error('Supabase create concert error:', error);
        mockConcertsStore.unshift(newConcert);
        return newConcert;
      }

      return {
        ...data,
        youtube_urls: Array.isArray(data.youtube_urls) ? data.youtube_urls : [],
        activities: []
      };
    } catch (err) {
      console.error('Supabase insertion failed, falling back to mock store:', err);
      mockConcertsStore.unshift(newConcert);
      return newConcert;
    }
  }

  mockConcertsStore.unshift(newConcert);
  return newConcert;
}

export async function addOrUpdateActivity(
  concertId: string,
  userName: string,
  actionType: ActionType,
  commentText?: string
): Promise<Activity> {
  const newActivity: Activity = {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `act-${Date.now()}`,
    concert_id: concertId,
    user_name: userName.trim(),
    action_type: actionType,
    comment_text: commentText ? commentText.trim() : null,
    created_at: new Date().toISOString()
  };

  if (supabase) {
    try {
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
        console.error('Supabase add activity error:', error);
      } else if (data) {
        return data;
      }
    } catch (err) {
      console.error('Supabase activity insertion exception:', err);
    }
  }

  // Update mock store
  const targetConcert = mockConcertsStore.find(c => c.id === concertId);
  if (targetConcert) {
    if (!targetConcert.activities) targetConcert.activities = [];
    targetConcert.activities.push(newActivity);
  }

  return newActivity;
}
