import { NextRequest, NextResponse } from 'next/server';
import {
  getDiscoverUrls,
  extractAllRawEventsAlternativeD,
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

    const previousEvents = Array.isArray(targetUrl.last_extracted_json)
      ? targetUrl.last_extracted_json
      : undefined;

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = (data: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          const finalRawEvents = await extractAllRawEventsAlternativeD(
            targetUrl.url,
            previousEvents,
            (progress) => {
              sendEvent(progress);
            }
          );

          // Save final extracted JSON in Supabase
          const updatedUrl = await updateDiscoverUrlLastExtracted(targetUrl.id, finalRawEvents);

          sendEvent({
            type: 'complete',
            url: updatedUrl,
            raw_events: finalRawEvents
          });
        } catch (err) {
          sendEvent({
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          });
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      }
    });
  } catch (error) {
    console.error('API Error POST /api/discover/extract-raw:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to extract raw events' },
      { status: 500 }
    );
  }
}
