import { NextRequest, NextResponse } from 'next/server';
import { getDiscoverPreferences, updateDiscoverPreferences } from '@/lib/discover';

export async function GET() {
  try {
    const preferences = await getDiscoverPreferences();
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error('API Error GET /api/discover/preferences:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { content } = body;

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'Content string is required' }, { status: 400 });
    }

    const updated = await updateDiscoverPreferences(content);
    return NextResponse.json({ preferences: updated });
  } catch (error) {
    console.error('API Error PUT /api/discover/preferences:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update preferences' },
      { status: 500 }
    );
  }
}
