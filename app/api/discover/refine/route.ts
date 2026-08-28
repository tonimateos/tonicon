import { NextRequest, NextResponse } from 'next/server';
import { generatePreferenceRule, appendDiscoverPreferenceRule } from '@/lib/discover';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { event_name, venue_name, date, rejection_reason, auto_append } = body;

    if (!event_name || !rejection_reason) {
      return NextResponse.json({ error: 'event_name and rejection_reason are required' }, { status: 400 });
    }

    const rule = await generatePreferenceRule({ event_name, venue_name, date }, rejection_reason);

    let updatedPreferences;
    if (auto_append) {
      updatedPreferences = await appendDiscoverPreferenceRule(rule);
    }

    return NextResponse.json({ rule, preferences: updatedPreferences });
  } catch (error) {
    console.error('API Error POST /api/discover/refine:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate preference rule' },
      { status: 500 }
    );
  }
}
