import { NextRequest, NextResponse } from 'next/server';
import { fetchActiveLessonBuild, clearActiveLessonBuild } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const draft = await fetchActiveLessonBuild();
    return NextResponse.json({ success: true, draft });
  } catch (err: any) {
    console.error('Error in GET /api/lessons/draft:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch active draft' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Unauthorized. Admin password required.' }, { status: 401 });
    }

    await clearActiveLessonBuild();
    return NextResponse.json({ success: true, message: 'Active draft cleared' });
  } catch (err: any) {
    console.error('Error in DELETE /api/lessons/draft:', err);
    return NextResponse.json({ error: err.message || 'Failed to clear active draft' }, { status: 500 });
  }
}
