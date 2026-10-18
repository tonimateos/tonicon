import { NextRequest, NextResponse } from 'next/server';

// In-memory cache for fast repeated lookups
const searchCache = new Map<string, string>();

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const query = searchParams.get('q') || '';

  if (!query.trim()) {
    return NextResponse.json({ error: 'Query parameter q is required' }, { status: 400 });
  }

  const cleanQuery = query.trim();

  if (searchCache.has(cleanQuery)) {
    return NextResponse.json({ videoId: searchCache.get(cleanQuery) });
  }

  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!res.ok) {
      throw new Error(`YouTube search returned status ${res.status}`);
    }

    const html = await res.text();

    // Look for videoId in the page payload
    // Priority: standard watch link or JSON videoId
    const matchJson = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    const matchHref = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);

    const videoId = (matchJson && matchJson[1]) || (matchHref && matchHref[1]);

    if (videoId) {
      searchCache.set(cleanQuery, videoId);
      return NextResponse.json({ videoId });
    }

    return NextResponse.json({ error: 'Could not extract video ID from search results' }, { status: 404 });
  } catch (err: any) {
    console.error('Error resolving YouTube video ID for query:', cleanQuery, err);
    return NextResponse.json({ error: err.message || 'Failed to resolve YouTube video ID' }, { status: 500 });
  }
}
