import { NextRequest, NextResponse } from 'next/server';
import { generateFullLessonV2, refineLessonGemini } from '@/lib/gemini';
import { fetchActiveLessonBuild } from '@/lib/supabase';
import { LessonStreamEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow sufficient time for multi-step long-form generation

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      userPrompt,
      originalPrompt,
      previousLesson,
      userSuggestion,
      password,
      language = 'en',
      stream = true
    } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Unauthorized. Admin password required.' }, { status: 401 });
    }

    const targetLang: 'en' | 'es' = language === 'es' ? 'es' : 'en';

    // Refinement action
    if (action === 'refine') {
      if (!originalPrompt || !previousLesson || !userSuggestion) {
        return NextResponse.json(
          { error: 'originalPrompt, previousLesson, and userSuggestion are required for refinement.' },
          { status: 400 }
        );
      }
      const result = await refineLessonGemini(originalPrompt, previousLesson, userSuggestion, targetLang);
      return NextResponse.json({ success: true, ...result });
    }

    // Resume action for an existing draft
    if (action === 'resume') {
      const draft = await fetchActiveLessonBuild();
      if (!draft || !draft.outline_json) {
        return NextResponse.json({ error: 'No active draft found to resume.' }, { status: 404 });
      }

      const promptToUse = draft.topic_prompt;
      const startFrom = draft.chapters_json ? draft.chapters_json.length : 0;
      const draftLang = draft.outline_json.language || draft.language || targetLang;

      if (stream) {
        const readable = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const sendEvent = async (event: LessonStreamEvent) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            };

            try {
              await generateFullLessonV2(promptToUse, sendEvent, startFrom, draftLang);
              controller.close();
            } catch (err: any) {
              console.error('Error during streamed resume generation:', err);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Generation failed' })}\n\n`)
              );
              controller.close();
            }
          }
        });

        return new Response(readable, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive'
          }
        });
      }

      const result = await generateFullLessonV2(promptToUse, undefined, startFrom, draftLang);
      return NextResponse.json({ success: true, ...result });
    }

    // Default action: generate fresh
    if (!userPrompt || !userPrompt.trim()) {
      return NextResponse.json({ error: 'userPrompt is required.' }, { status: 400 });
    }

    const cleanPrompt = userPrompt.trim();

    if (stream) {
      const readable = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          const sendEvent = async (event: LessonStreamEvent) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          };

          try {
            await generateFullLessonV2(cleanPrompt, sendEvent, 0, targetLang);
            controller.close();
          } catch (err: any) {
            console.error('Error during streamed lesson generation:', err);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Generation failed' })}\n\n`)
            );
            controller.close();
          }
        }
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive'
        }
      });
    }

    const result = await generateFullLessonV2(cleanPrompt, undefined, 0, targetLang);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Failed to generate lesson with Gemini:', err);
    return NextResponse.json({ error: err.message || 'Failed to generate lesson' }, { status: 500 });
  }
}
