import { NextRequest, NextResponse } from 'next/server';
import { getDiscoverUrls, addDiscoverUrl, deleteDiscoverUrl } from '@/lib/discover';

export async function GET() {
  try {
    const urls = await getDiscoverUrls();
    return NextResponse.json({ urls });
  } catch (error) {
    console.error('API Error GET /api/discover/urls:', error);
    return NextResponse.json({ error: 'Failed to fetch source URLs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, name } = body;

    if (!url || typeof url !== 'string' || !url.trim()) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    const created = await addDiscoverUrl(url, name);
    return NextResponse.json({ url: created }, { status: 201 });
  } catch (error) {
    console.error('API Error POST /api/discover/urls:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to add URL' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    await deleteDiscoverUrl(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('API Error DELETE /api/discover/urls:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete URL' },
      { status: 500 }
    );
  }
}
