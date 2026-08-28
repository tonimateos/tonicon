import { NextResponse } from 'next/server';
import { runOnDemandDiscovery } from '@/lib/discover';

export async function POST() {
  try {
    const result = await runOnDemandDiscovery();
    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error POST /api/discover/scrape:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run event discovery' },
      { status: 500 }
    );
  }
}
