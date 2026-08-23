import { NextRequest, NextResponse } from 'next/server';
import { fetchAllConcerts, createConcert } from '@/lib/supabase';

export async function GET() {
  try {
    const concerts = await fetchAllConcerts();
    return NextResponse.json({ concerts });
  } catch (error: any) {
    console.error('Error fetching concerts:', error);
    return NextResponse.json({ error: 'Failed to load concerts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password, band_name, venue_name, date, url, youtube_urls, toni_comment } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';

    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Incorrect password! Only Toni can add concerts.' }, { status: 401 });
    }

    if (!band_name || !venue_name || !date) {
      return NextResponse.json({ error: 'Band name, venue name, and concert date are required.' }, { status: 400 });
    }

    // Clean youtube URLs array (max 3)
    const cleanedYoutubeUrls = Array.isArray(youtube_urls)
      ? youtube_urls.filter((u: string) => typeof u === 'string' && u.trim().length > 0).slice(0, 3)
      : [];

    const newConcert = await createConcert({
      band_name: band_name.trim(),
      venue_name: venue_name.trim(),
      date: new Date(date).toISOString(),
      url: url ? url.trim() : null,
      youtube_urls: cleanedYoutubeUrls,
      toni_comment: toni_comment ? toni_comment.trim() : null,
    });

    return NextResponse.json({ concert: newConcert }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating concert:', error);
    return NextResponse.json({ error: error?.message || 'Failed to create concert' }, { status: 500 });
  }
}
