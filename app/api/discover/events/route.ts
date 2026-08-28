import { NextRequest, NextResponse } from 'next/server';
import { getDiscoverEvents, updateDiscoverEventStatus } from '@/lib/discover';
import { DiscoverEventStatus } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status') as DiscoverEventStatus | null;

    const events = await getDiscoverEvents(statusParam || undefined);
    return NextResponse.json({ events });
  } catch (error) {
    console.error('API Error GET /api/discover/events:', error);
    return NextResponse.json({ error: 'Failed to fetch discover events' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status, rejection_reason } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'Event id and status are required' }, { status: 400 });
    }

    const updated = await updateDiscoverEventStatus(id, status, rejection_reason);
    return NextResponse.json({ event: updated });
  } catch (error) {
    console.error('API Error PATCH /api/discover/events:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update event status' },
      { status: 500 }
    );
  }
}
