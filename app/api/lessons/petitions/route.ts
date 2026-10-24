import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAllPodcastPetitions,
  createPodcastPetition,
  deletePodcastPetition
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const petitions = await fetchAllPodcastPetitions();
    return NextResponse.json({ petitions });
  } catch (err: any) {
    console.error('Failed to fetch podcast petitions:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch petitions' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, petition } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Name of the petitioner is required.' },
        { status: 400 }
      );
    }

    if (!petition || typeof petition !== 'string' || !petition.trim()) {
      return NextResponse.json(
        { error: 'Petition topic or description is required.' },
        { status: 400 }
      );
    }

    const saved = await createPodcastPetition({
      name: name.trim(),
      petition: petition.trim()
    });

    return NextResponse.json({ success: true, petition: saved }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to save podcast petition:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to save petition' },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json(
        { error: 'Unauthorized. Admin password required.' },
        { status: 401 }
      );
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Petition ID is required for deletion.' },
        { status: 400 }
      );
    }

    await deletePodcastPetition(id);

    return NextResponse.json({ success: true, message: 'Petition deleted.' });
  } catch (err: any) {
    console.error('Failed to delete podcast petition:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to delete petition' },
      { status: 500 }
    );
  }
}
