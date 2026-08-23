import { NextRequest, NextResponse } from 'next/server';
import { scrapeConcertUrl } from '@/lib/gemini';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return NextResponse.json({ error: 'Valid URL starting with http:// or https:// is required.' }, { status: 400 });
    }

    const scrapedData = await scrapeConcertUrl(url);
    return NextResponse.json(scrapedData);
  } catch (error: any) {
    console.error('Error in /api/scrape:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to parse web page details.' },
      { status: 500 }
    );
  }
}
