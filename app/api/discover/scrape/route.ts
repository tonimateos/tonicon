import { NextRequest, NextResponse } from 'next/server';
import { runOnDemandDiscovery } from '@/lib/discover';

export async function POST(req: NextRequest) {
  try {
    let url_id: string | undefined;
    try {
      const body = await req.json();
      url_id = body.url_id;
    } catch {
      // Body optional
    }

    if (!url_id) {
      const { searchParams } = new URL(req.url);
      url_id = searchParams.get('url_id') || undefined;
    }

    const result = await runOnDemandDiscovery(url_id);
    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error POST /api/discover/scrape:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run event discovery' },
      { status: 500 }
    );
  }
}

