import { NextRequest, NextResponse } from 'next/server';
import {
  fetchAllPodcastComments,
  createPodcastComment,
  deletePodcastComment
} from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const comments = await fetchAllPodcastComments();
    return NextResponse.json({ comments, petitions: comments });
  } catch (err: any) {
    console.error('Failed to fetch podcast comments:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, comment, petition } = body;
    const finalComment = comment || petition;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json(
        { error: 'Name is required.' },
        { status: 400 }
      );
    }

    if (!finalComment || typeof finalComment !== 'string' || !finalComment.trim()) {
      return NextResponse.json(
        { error: 'Comment text is required.' },
        { status: 400 }
      );
    }

    const saved = await createPodcastComment({
      name: name.trim(),
      comment: finalComment.trim()
    });

    return NextResponse.json(
      { success: true, comment: saved, petition: { ...saved, petition: saved.comment } },
      { status: 201 }
    );
  } catch (err: any) {
    console.error('Failed to save podcast comment:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to save comment' },
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
        { error: 'Comment ID is required for deletion.' },
        { status: 400 }
      );
    }

    await deletePodcastComment(id);

    return NextResponse.json({ success: true, message: 'Comment deleted.' });
  } catch (err: any) {
    console.error('Failed to delete podcast comment:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to delete comment' },
      { status: 500 }
    );
  }
}
