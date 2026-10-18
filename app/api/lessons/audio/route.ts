import { NextRequest, NextResponse } from 'next/server';
import {
  fetchLessonById,
  fetchLessonAudioSegments,
  saveLessonAudioSegments,
  uploadLessonAudio
} from '@/lib/supabase';
import { generateSpeechSegment, hashText, sanitizeSpokenText } from '@/lib/gemini';
import { AudioSegment, AudioStreamEvent, extractQuotaWaitTime, isQuotaError } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow sufficient time for multi-paragraph speech generation

import { parseLessonSegments } from '@/lib/lesson-parser';

interface ParsedSegment {
  id: number;
  type: 'heading' | 'paragraph';
  text: string;
}

function parseLessonContentToSegments(content: string): ParsedSegment[] {
  const parsed = parseLessonSegments(content);
  return parsed
    .filter((s) => s.type === 'heading' || s.type === 'paragraph')
    .map((s) => ({
      id: s.spokenId ?? s.id,
      type: s.type as 'heading' | 'paragraph',
      text: s.rawSpeechText || s.text
    }));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const lessonId = searchParams.get('lessonId');

    if (!lessonId) {
      return NextResponse.json({ error: 'lessonId is required' }, { status: 400 });
    }

    const audioMeta = await fetchLessonAudioSegments(lessonId);
    return NextResponse.json({ success: true, ...audioMeta });
  } catch (err: any) {
    console.error('Error fetching lesson audio segments:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch audio' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { lessonId, action = 'render', voiceName = 'Puck', password } = body;

    const expectedPassword = process.env.TONI_ADMIN_PASSWORD || 'tonipass';
    if (!password || password.trim() !== expectedPassword.trim()) {
      return NextResponse.json({ error: 'Unauthorized. Admin password required.' }, { status: 401 });
    }

    if (!lessonId) {
      return NextResponse.json({ error: 'lessonId is required.' }, { status: 400 });
    }

    const lesson = await fetchLessonById(lessonId);
    if (!lesson) {
      return NextResponse.json({ error: 'Lesson not found.' }, { status: 404 });
    }

    // Handle pause action
    if (action === 'pause') {
      const existing = await fetchLessonAudioSegments(lessonId);
      await saveLessonAudioSegments(lessonId, existing.audio_segments, 'paused');
      return NextResponse.json({ success: true, message: 'Audio conversion paused', status: 'paused' });
    }

    // Parse all segments from the lesson's content
    const allSegments = parseLessonContentToSegments(lesson.content);
    if (allSegments.length === 0) {
      return NextResponse.json({ error: 'No spoken text segments found in this lesson.' }, { status: 400 });
    }

    // Load existing completed segments
    const existingAudio = await fetchLessonAudioSegments(lessonId);
    const completedMap = new Map<number, AudioSegment>();
    for (const seg of existingAudio.audio_segments || []) {
      completedMap.set(seg.segment_id, seg);
    }

    // Set status to in_progress
    await saveLessonAudioSegments(lessonId, Array.from(completedMap.values()), 'in_progress');

    // Create SSE Stream
    const readable = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const sendEvent = async (event: AudioStreamEvent) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };

        try {
          const completedList: AudioSegment[] = [...completedMap.values()];
          const totalCount = allSegments.length;

          await sendEvent({
            type: 'status',
            message: `Starting studio voice conversion (${completedList.length}/${totalCount} segments ready)...`,
            completedCount: completedList.length,
            totalCount
          });

          for (let i = 0; i < allSegments.length; i++) {
            const seg = allSegments[i];
            const textHash = hashText(seg.text);

            // Check if already completed and text hasn't changed
            const existingSeg = completedMap.get(seg.id);
            if (existingSeg && existingSeg.text_hash === textHash && existingSeg.audio_url) {
              continue; // Already converted and cached!
            }

            await sendEvent({
              type: 'status',
              message: `Converting segment ${i + 1} of ${totalCount} (${seg.type === 'heading' ? 'Heading' : 'Paragraph'})...`,
              completedCount: completedList.length,
              totalCount
            });

            // 1. Generate speech via Gemini TTS
            const { wavBuffer, durationSeconds } = await generateSpeechSegment(seg.text, voiceName, lesson.language);

            // 2. Upload to Supabase Storage (with local fallback)
            const audioUrl = await uploadLessonAudio(lessonId, seg.id, textHash, wavBuffer);

            // 3. Create AudioSegment record
            const newAudioSeg: AudioSegment = {
              segment_id: seg.id,
              type: seg.type,
              text_hash: textHash,
              audio_url: audioUrl,
              duration_seconds: durationSeconds,
              created_at: new Date().toISOString()
            };

            // Update local memory and persist to DB immediately
            completedMap.set(seg.id, newAudioSeg);
            const currentSegments = Array.from(completedMap.values()).sort((a, b) => a.segment_id - b.segment_id);

            await saveLessonAudioSegments(lessonId, currentSegments, 'in_progress');

            await sendEvent({
              type: 'segment_ready',
              segment: newAudioSeg,
              completedCount: currentSegments.length,
              totalCount
            });
          }

          // Finalize state
          const finalSegments = Array.from(completedMap.values()).sort((a, b) => a.segment_id - b.segment_id);
          await saveLessonAudioSegments(lessonId, finalSegments, 'ready');

          await sendEvent({
            type: 'complete',
            lessonId,
            totalSegments: finalSegments.length,
            audioSegments: finalSegments
          });

          controller.close();
        } catch (streamErr: any) {
          console.error('Error during audio generation stream:', streamErr);
          // Mark as paused so it can be resumed
          const currentSegments = Array.from(completedMap.values()).sort((a, b) => a.segment_id - b.segment_id);
          await saveLessonAudioSegments(lessonId, currentSegments, 'paused').catch(() => {});

          const isQuota = Boolean(streamErr.isQuota || streamErr.name === 'GeminiQuotaExceededError' || isQuotaError(streamErr.message));
          const waitTime = streamErr.retryAfter || extractQuotaWaitTime(streamErr.message);

          const errorMessage = isQuota
            ? (waitTime ? `Gemini API quota exceeded. Please retry in ${waitTime}.` : `Gemini API quota exceeded.`)
            : (streamErr.message || 'Audio conversion failed');

          const errorPayload: AudioStreamEvent = {
            type: 'error',
            error: errorMessage,
            isQuota,
            retryAfter: waitTime || undefined
          };

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorPayload)}\n\n`)
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
  } catch (err: any) {
    console.error('Error in POST /api/lessons/audio:', err);
    return NextResponse.json({ error: err.message || 'Audio rendering failed' }, { status: 500 });
  }
}
