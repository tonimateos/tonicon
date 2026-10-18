import { NextRequest, NextResponse } from 'next/server';
import {
  fetchLessonById,
  fetchLessonAudioSegments,
  saveLessonAudioSegments,
  uploadLessonAudio
} from '@/lib/supabase';
import { generateSpeechSegment, hashText, sanitizeSpokenText } from '@/lib/gemini';
import { AudioSegment, AudioStreamEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Allow sufficient time for multi-paragraph speech generation

interface ParsedSegment {
  id: number;
  type: 'heading' | 'paragraph';
  text: string;
}

function parseLessonContentToSegments(content: string): ParsedSegment[] {
  const lines = content.split('\n');
  const segments: ParsedSegment[] = [];
  let currentParagraph = '';
  let segmentIdCounter = 0;

  const flushParagraph = () => {
    if (currentParagraph.trim()) {
      const clean = sanitizeSpokenText(currentParagraph);
      if (clean.length > 2) {
        segments.push({
          id: segmentIdCounter++,
          type: 'paragraph',
          text: currentParagraph.trim()
        });
      }
      currentParagraph = '';
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    // Skip top title # (intro text is spoken, title heading is omitted or spoken as intro)
    if (line.startsWith('# ')) {
      continue;
    }

    // Heading ##
    if (line.startsWith('## ') || line.startsWith('### ')) {
      flushParagraph();
      const headingTitle = line.replace(/^#+\s*/, '').trim();
      if (headingTitle) {
        segments.push({
          id: segmentIdCounter++,
          type: 'heading',
          text: headingTitle
        });
      }
      continue;
    }

    // Check if line is an inline song link
    const isSongLink =
      /\[(?:Play\s+)?(.*?)(?:\s+on\s+YouTube)?\]\(https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+\)/i.test(line) ||
      /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s)]+$/i.test(line);

    if (isSongLink) {
      flushParagraph();
      // Song links are not converted to speech because they are played via YouTube embeds
      continue;
    }

    // Normal text
    if (currentParagraph) {
      currentParagraph += ' ' + line;
    } else {
      currentParagraph = line;
    }
  }

  flushParagraph();
  return segments;
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
            const { wavBuffer, durationSeconds } = await generateSpeechSegment(seg.text, voiceName);

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

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: streamErr.message || 'Audio conversion failed' })}\n\n`)
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
