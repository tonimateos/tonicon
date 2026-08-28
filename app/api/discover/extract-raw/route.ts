import { NextRequest, NextResponse } from 'next/server';
import {
  getDiscoverUrls,
  pruneHtml,
  extractAllRawEventsFromHtml,
  updateDiscoverUrlLastExtracted
} from '@/lib/discover';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url_id } = body;

    if (!url_id) {
      return NextResponse.json({ error: 'url_id parameter is required' }, { status: 400 });
    }

    const urls = await getDiscoverUrls();
    const targetUrl = urls.find((u) => u.id === url_id);

    if (!targetUrl) {
      return NextResponse.json({ error: 'Source URL not found' }, { status: 404 });
    }

    const res = await fetch(targetUrl.url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store'
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL ${targetUrl.url} (HTTP status: ${res.status})` },
        { status: 502 }
      );
    }

    const rawHtml = await res.text();
    const pruned = pruneHtml(rawHtml);

    // Pass previous JSON to skip already extracted / unchanged events
    const previousEvents = Array.isArray(targetUrl.last_extracted_json)
      ? targetUrl.last_extracted_json
      : undefined;

    const rawEvents = await extractAllRawEventsFromHtml(pruned, targetUrl.url, previousEvents);

    // Combine or update with newly extracted raw events
    const finalRawEvents =
      previousEvents && previousEvents.length > 0 && rawEvents.length === 0
        ? previousEvents
        : rawEvents;

    // Save newly extracted JSON to DB for this source
    const updatedUrl = await updateDiscoverUrlLastExtracted(targetUrl.id, finalRawEvents);

    return NextResponse.json({
      url: updatedUrl,
      raw_events: finalRawEvents
    });
  } catch (error) {
    console.error('API Error POST /api/discover/extract-raw:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract raw events' },
      { status: 500 }
    );
  }
}
