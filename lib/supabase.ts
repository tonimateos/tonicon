import { createClient } from '@supabase/supabase-js';
import { Concert, Activity, ActionType, Lesson, ActiveLessonBuild, AudioSegment } from './types';
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

// -------------------------------------------------------------
// Active Lesson Build / In-Progress Podcast State Persistence
// -------------------------------------------------------------
const LOCAL_ACTIVE_BUILD_FILE = path.join(process.cwd(), 'data', 'active_build.json');

function getLocalActiveBuild(): ActiveLessonBuild | null {
  try {
    if (fs.existsSync(LOCAL_ACTIVE_BUILD_FILE)) {
      const data = fs.readFileSync(LOCAL_ACTIVE_BUILD_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error reading local active build:', e);
  }
  return null;
}

function saveLocalActiveBuild(build: ActiveLessonBuild | null) {
  try {
    const dir = path.dirname(LOCAL_ACTIVE_BUILD_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (build) {
      fs.writeFileSync(LOCAL_ACTIVE_BUILD_FILE, JSON.stringify(build, null, 2), 'utf-8');
    } else if (fs.existsSync(LOCAL_ACTIVE_BUILD_FILE)) {
      fs.unlinkSync(LOCAL_ACTIVE_BUILD_FILE);
    }
  } catch (e) {
    console.error('Error saving local active build:', e);
  }
}

export async function fetchActiveLessonBuild(): Promise<ActiveLessonBuild | null> {
  try {
    const { data, error } = await supabase
      .from('active_lesson_build')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return {
        ...data,
        outline_json: data.outline_json || null,
        chapters_json: Array.isArray(data.chapters_json) ? data.chapters_json : []
      };
    }

    if (error && error.code === 'PGRST205') {
      return getLocalActiveBuild();
    }
  } catch (err) {
    console.warn('Supabase fetchActiveLessonBuild error, falling back to local file:', err);
  }
  return getLocalActiveBuild();
}

export async function saveActiveLessonBuild(
  buildData: Partial<ActiveLessonBuild> & { topic_prompt: string }
): Promise<ActiveLessonBuild> {
  const existing = await fetchActiveLessonBuild();
  const id = existing?.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `draft-${Date.now()}`);

  const updated: ActiveLessonBuild = {
    id,
    topic_prompt: buildData.topic_prompt,
    title: buildData.title !== undefined ? buildData.title : (existing?.title || null),
    outline_json: buildData.outline_json !== undefined ? buildData.outline_json : (existing?.outline_json || null),
    chapters_json: buildData.chapters_json !== undefined ? buildData.chapters_json : (existing?.chapters_json || []),
    content: buildData.content !== undefined ? buildData.content : (existing?.content || ''),
    status: buildData.status || existing?.status || 'in_progress',
    current_step: buildData.current_step !== undefined ? buildData.current_step : (existing?.current_step || null),
    updated_at: new Date().toISOString()
  };

  try {
    const { data, error } = await supabase
      .from('active_lesson_build')
      .upsert([{
        id: updated.id,
        topic_prompt: updated.topic_prompt,
        title: updated.title,
        outline_json: updated.outline_json,
        chapters_json: updated.chapters_json,
        content: updated.content,
        status: updated.status,
        current_step: updated.current_step,
        updated_at: updated.updated_at
      }])
      .select()
      .single();

    if (!error && data) {
      saveLocalActiveBuild(data);
      return data;
    }

    if (error) {
      console.warn('Error saving active_lesson_build in Supabase, using local file:', error);
      saveLocalActiveBuild(updated);
      return updated;
    }
  } catch (err) {
    console.warn('Error connecting to Supabase for active_lesson_build, saving locally:', err);
  }

  saveLocalActiveBuild(updated);
  return updated;
}

export async function clearActiveLessonBuild(): Promise<void> {
  try {
    await supabase.from('active_lesson_build').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  } catch (err) {
    console.warn('Error deleting active_lesson_build from Supabase:', err);
  }
  saveLocalActiveBuild(null);
}

// -------------------------------------------------------------
// Lesson v3: Audio Segments & Supabase Storage Persistence
// -------------------------------------------------------------
const LOCAL_AUDIO_METADATA_DIR = path.join(process.cwd(), 'data', 'audio_meta');

function getLocalAudioMeta(lessonId: string): { audio_status: string; audio_voice: string; audio_segments: AudioSegment[] } {
  try {
    const metaFile = path.join(LOCAL_AUDIO_METADATA_DIR, `${lessonId}.json`);
    if (fs.existsSync(metaFile)) {
      return JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
    }
  } catch (e) {
    console.error('Error reading local audio meta:', e);
  }
  return { audio_status: 'none', audio_voice: 'default', audio_segments: [] };
}

function saveLocalAudioMeta(lessonId: string, data: { audio_status: string; audio_voice: string; audio_segments: AudioSegment[] }) {
  try {
    if (!fs.existsSync(LOCAL_AUDIO_METADATA_DIR)) {
      fs.mkdirSync(LOCAL_AUDIO_METADATA_DIR, { recursive: true });
    }
    const metaFile = path.join(LOCAL_AUDIO_METADATA_DIR, `${lessonId}.json`);
    fs.writeFileSync(metaFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving local audio meta:', e);
  }
}

export async function uploadLessonAudio(
  lessonId: string,
  segmentId: number,
  textHash: string,
  wavBuffer: Buffer
): Promise<string> {
  const filePath = `${lessonId}/segment_${segmentId}_${textHash}.wav`;

  try {
    const { data, error } = await supabase.storage
      .from('lesson-audio')
      .upload(filePath, wavBuffer, {
        contentType: 'audio/wav',
        upsert: true
      });

    if (!error && data) {
      const { data: publicUrlData } = supabase.storage
        .from('lesson-audio')
        .getPublicUrl(filePath);
      return publicUrlData.publicUrl;
    }

    if (error) {
      console.warn('Supabase storage upload error, saving to local public folder:', error);
    }
  } catch (err) {
    console.warn('Storage exception, saving locally:', err);
  }

  // Local fallback: save to public/audio/lessons/{lessonId}/...
  try {
    const localDir = path.join(process.cwd(), 'public', 'audio', 'lessons', lessonId);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }
    const localFile = path.join(localDir, `segment_${segmentId}_${textHash}.wav`);
    fs.writeFileSync(localFile, wavBuffer);
    return `/audio/lessons/${lessonId}/segment_${segmentId}_${textHash}.wav`;
  } catch (localErr) {
    console.error('Error saving audio locally:', localErr);
    // Base64 data URI fallback as last resort
    return `data:audio/wav;base64,${wavBuffer.toString('base64')}`;
  }
}

export async function fetchLessonById(lessonId: string): Promise<Lesson | null> {
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('*')
      .eq('id', lessonId)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  } catch (err) {
    console.warn('Error fetching lesson by ID from Supabase:', err);
  }

  const local = getLocalLessons().find((l) => l.id === lessonId);
  return local || null;
}

export async function fetchLessonAudioSegments(lessonId: string): Promise<{
  audio_status: string;
  audio_voice: string;
  audio_segments: AudioSegment[];
}> {
  try {
    const { data, error } = await supabase
      .from('lessons')
      .select('audio_status, audio_voice, audio_segments')
      .eq('id', lessonId)
      .maybeSingle();

    if (!error && data) {
      return {
        audio_status: data.audio_status || 'none',
        audio_voice: data.audio_voice || 'default',
        audio_segments: Array.isArray(data.audio_segments) ? data.audio_segments : []
      };
    }
  } catch (err) {
    console.warn('Error fetching audio segments from Supabase, checking local:', err);
  }

  return getLocalAudioMeta(lessonId);
}

export async function saveLessonAudioSegments(
  lessonId: string,
  segments: AudioSegment[],
  status: 'none' | 'in_progress' | 'paused' | 'ready'
): Promise<void> {
  const meta = {
    audio_status: status,
    audio_voice: 'Puck',
    audio_segments: segments
  };

  saveLocalAudioMeta(lessonId, meta);

  try {
    const { error } = await supabase
      .from('lessons')
      .update({
        audio_status: status,
        audio_segments: segments,
        audio_voice: 'Puck'
      })
      .eq('id', lessonId);

    if (error) {
      console.warn('Could not update audio columns in Supabase (may need SQL migration), stored in local fallback:', error.message);
    }
  } catch (err) {
    console.warn('Error updating lesson audio in Supabase:', err);
  }
}

