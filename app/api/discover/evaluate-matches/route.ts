import { NextRequest, NextResponse } from 'next/server';
import {
  getDiscoverPreferences,
  getDiscoverEvents,
  createDiscoverEvent,
  filterEventsWithPreferences,
  mergeNewToPastExtracted,
  getDiscoverUrls
} from '@/lib/discover';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url_id, source_url, raw_events } = body;

    if (!raw_events || !Array.isArray(raw_events)) {
      return NextResponse.json({ error: 'raw_events array is required' }, { status: 400 });
    }

    const preferences = await getDiscoverPreferences();
    const existingEvents = await getDiscoverEvents();

    // Create a normalized set of existing event names/dates to prevent duplicates
    const existingSet = new Set(
      existingEvents.map((e) => `${e.event_name.toLowerCase().trim()}|${(e.date || '').slice(0, 10)}`)
    );

    const matches = await filterEventsWithPreferences(raw_events, preferences.content, source_url || '');

    let addedCount = 0;
    const addedEvents = [];

    for (const item of matches) {
      const key = `${item.event_name.toLowerCase().trim()}|${(item.date || '').slice(0, 10)}`;
      if (!existingSet.has(key)) {
        existingSet.add(key);
        const created = await createDiscoverEvent({
          event_name: item.event_name,
          venue_name: item.venue_name || null,
          date: item.date || null,
          url: item.url || source_url || null,
          status: 'candidate',
          match_reason: item.match_reason || null,
          source_url: source_url || null
        });
        addedEvents.push(created);
        addedCount++;
      }
    }

    // Merge New JSON into Past JSON for this source after successful send to LLM
    let targetUrlId = url_id;
    if (!targetUrlId && source_url) {
      const urls = await getDiscoverUrls();
      const match = urls.find((u) => u.url === source_url);
      if (match) targetUrlId = match.id;
    }

    let updatedUrl = null;
    if (targetUrlId) {
      updatedUrl = await mergeNewToPastExtracted(targetUrlId);
    }

    return NextResponse.json({
      added: addedCount,
      matched_events: matches,
      events: addedEvents,
      url: updatedUrl
    });
  } catch (error) {
    console.error('API Error POST /api/discover/evaluate-matches:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to evaluate matches' },
      { status: 500 }
    );
  }
}
