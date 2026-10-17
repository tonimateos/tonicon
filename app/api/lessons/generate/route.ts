import { NextRequest, NextResponse } from 'next/server';
import { generateLessonGemini, refineLessonGemini } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Allow sufficient time for LLM generation

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userPrompt, originalPrompt, previousLesson, userSuggestion, password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Unauthorized. Admin password required.' }, { status: 401 });
    }

    if (action === 'refine') {
      if (!originalPrompt || !previousLesson || !userSuggestion) {
        return NextResponse.json(
          { error: 'originalPrompt, previousLesson, and userSuggestion are required for refinement.' },
          { status: 400 }
        );
      }
      const result = await refineLessonGemini(originalPrompt, previousLesson, userSuggestion);
      return NextResponse.json({ success: true, ...result });
    }

    // Default action: generate
    if (!userPrompt || !userPrompt.trim()) {
      return NextResponse.json({ error: 'userPrompt is required.' }, { status: 400 });
    }

    const result = await generateLessonGemini(userPrompt.trim());
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Failed to generate lesson with Gemini:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate lesson' }, { status: 500 });
  }
}
