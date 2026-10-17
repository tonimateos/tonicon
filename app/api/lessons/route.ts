import { NextRequest, NextResponse } from 'next/server';
import { fetchAllLessons, createLesson } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const lessons = await fetchAllLessons();
    return NextResponse.json({ lessons });
  } catch (err: any) {
    console.error('Failed to fetch lessons:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch lessons' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, topic_prompt, content, password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Unauthorized. Admin password required.' }, { status: 401 });
    }

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required.' }, { status: 400 });
    }

    const savedLesson = await createLesson({
      title: title.trim(),
      topic_prompt: (topic_prompt || '').trim(),
      content: content.trim()
    });

    return NextResponse.json({ success: true, lesson: savedLesson });
  } catch (err: any) {
    console.error('Failed to create lesson:', err);
    return NextResponse.json({ error: err.message || 'Failed to create lesson' }, { status: 500 });
  }
}
