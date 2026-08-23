import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';

    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Incorrect password! Only Toni can add concerts.' }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Auth verification error:', error);
    return NextResponse.json({ error: 'Authentication check failed.' }, { status: 500 });
  }
}
