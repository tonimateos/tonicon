# Specification: Music Lessons v3 — Paragraph-Level Broadcast Voice & Audio Caching

## 1. Goal & Vision
Upgrade the Music Lessons audio experience from client-side synthetic browser text-to-speech (`window.speechSynthesis`) to **broadcast-grade, human-like voice narration** with emotional depth, natural pauses, and studio fidelity:
- **Enabled Only on Saved Lessons**: To prevent wasting API costs, tokens, or storage on temporary or discarded drafts, audio conversion is **strictly available only once a lesson is Saved to the database** (and never earlier on in-progress drafts).
- **Progressive, Non-Destructive Conversion**: When triggered, paragraphs are converted to speech sequentially. Each paragraph audio clip is **immediately persisted to Supabase Storage and the database upon arrival**, ensuring that completed work is never lost or re-sent.
- **Resumable Audio Pipeline**: If conversion is stopped, cancelled, or interrupted (e.g., closing the tab or network drops), progress is preserved. As long as unconverted paragraphs remain, a prominent **"Resume Voice Conversion"** button allows picking up exactly where it stopped.
- **Granular Paragraph-Level Clips**: Each spoken paragraph/segment is rendered into an independent, lightweight audio file (~30–60 seconds each, ~50–120 KB).
- **Cache-Once, Listen-Forever**: Saved audio clips stream from Supabase Storage (`lesson-audio` bucket) for **$0 cost and instant load time** on all future plays.
- **Zero-Gap Seamless Double-Buffering**: While the user listens to paragraph $N$, the player silently preloads paragraph $N+1$, ensuring continuous playback with a natural, human breath pause (~300–450ms) between thoughts.
- **Instant 1-Click Resume After In-Page Music**: When narration pauses so the user can play an embedded YouTube track, clicking *"Resume from here"* on subsequent paragraphs immediately starts playing that exact audio clip without needing brittle seek-bar timestamps.
- **Incremental Invalidation**: If the user refines a single chapter or paragraph, only that segment's audio is regenerated. Unchanged chapters retain their cached audio files, saving 80–90% of audio generation time and cost.

---

## 2. Lifecycle: When & How Audio Conversion Operates

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Draft Building & Review (v2 Pipeline)               │
│ - Multi-chapter generation & live preview                   │
│ - Admin tests TTS with free browser voice                   │
│ - NO studio audio rendering allowed yet (avoids wasted cost)│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 2: "Save Lesson" Action                                │
│ - Admin clicks [Save Lesson]                                │
│ - Master text & chapters persisted to `public.lessons`      │
│ - Lesson now unlocks Studio Voice conversion capability     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ Step 3: Studio Voice Conversion Workflow                    │
│                                                             │
│ [ 🎙️ Convert to Studio Voice (0/52 Ready) ]                 │
│                 │                                           │
│                 ▼                                           │
│   Loop through unconverted paragraphs:                      │
│   1. Send paragraph text to Voice Model                     │
│   2. Upload returned audio -> Supabase Storage              │
│   3. Save segment metadata to `public.lessons` DB row       │
│                                                             │
│   ─── If Interrupted / Paused midway (e.g. at 24/52) ────   │
│   [ ▶️ Resume Voice Conversion (24/52 Ready) ]               │
│   (Picks up from paragraph 25; paragraphs 1-24 never resent)│
│                                                             │
│   ─── When 52/52 Paragraphs Complete ────────────────────   │
│   [ ✓ Studio Voice Ready • Listen to Podcast ]              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Database & Storage Architecture

### 1. Supabase Storage Bucket: `lesson-audio`
A public read-only bucket for fast CDN-cached audio delivery:
- **Bucket Name**: `lesson-audio`
- **File Path Convention**:
  ```
  lesson-audio/
    └── {lesson_id}/
          ├── segment_0_a9f8e.mp3
          ├── segment_1_b73c2.mp3
          ├── segment_2_e11d0.mp3
          └── ...
  ```
- **File size**: ~50 KB to 120 KB per paragraph (MP3/WebM audio, 64–96 kbps mono voice). Total per 40-minute episode: ~20–30 MB.

### 2. Database Schema Upgrades (`public.lessons`)
Add metadata columns to `public.lessons` to track audio rendering state and completed segments:

```sql
-- Track audio rendering state and cached segment references
ALTER TABLE public.lessons 
ADD COLUMN IF NOT EXISTS audio_status TEXT NOT NULL DEFAULT 'none', -- 'none' | 'in_progress' | 'paused' | 'ready'
ADD COLUMN IF NOT EXISTS audio_voice TEXT DEFAULT 'default',
ADD COLUMN IF NOT EXISTS audio_segments JSONB DEFAULT '[]'::jsonb;
```

#### Structure of `audio_segments` JSONB:
```json
[
  {
    "segment_id": 0,
    "type": "paragraph",
    "text_hash": "a9f8e432",
    "audio_url": "https://<supabase-url>/storage/v1/object/public/lesson-audio/<lesson_id>/segment_0_a9f8e432.mp3",
    "duration_seconds": 24.5,
    "created_at": "2026-10-18T08:45:00Z"
  },
  {
    "segment_id": 1,
    "type": "heading",
    "text_hash": "b73c2981",
    "audio_url": "https://<supabase-url>/storage/v1/object/public/lesson-audio/<lesson_id>/segment_1_b73c2981.mp3",
    "duration_seconds": 4.2,
    "created_at": "2026-10-18T08:45:08Z"
  }
]
```

---

## 4. Progressive Conversion Engine & Resumption Logic

### 1. Sequential Generation with Immediate Persistence
The audio conversion endpoint (`POST /api/lessons/audio/render`) accepts:
`{ lessonId: string, action: 'start' | 'resume' | 'pause', password: string }`

1. **Query Existing State**: The backend retrieves the lesson and its `audio_segments` array.
2. **Determine Remaining Segments**: Compares total parsed lesson segments against already completed segments in `audio_segments`.
3. **Progressive Loop**:
   - For each unconverted segment $k$:
     1. Pre-process text (strip markdown links, sound cues, speaker labels).
     2. Call Gemini Native Audio / Cloud TTS.
     3. Upload audio buffer directly to Supabase Storage: `lesson-audio/${lessonId}/segment_${k}_${hash}.mp3`.
     4. Append new segment object to `audio_segments` in `public.lessons` immediately.
     5. Emit SSE stream progress event to the frontend:
        `{ type: "segment_ready", completedCount: 25, totalCount: 52, segment: {...} }`
4. **Resumption Guarantee**: Because each segment is stored the moment it finishes, if the connection drops after paragraph 24, paragraphs 1–24 are already permanently saved. Resuming starts directly at paragraph 25.

---

## 5. Frontend UI: Saved Lesson Voice Controls

In [`components/LessonPlayer.tsx`](file:///Users/toni/gits/tonicon/components/LessonPlayer.tsx) and [`app/lessons/page.tsx`](file:///Users/toni/gits/tonicon/app/lessons/page.tsx):

### 1. When Viewing an Unsaved Draft
- The voice conversion button is **not rendered**.
- Only the free browser `window.speechSynthesis` player is active.
- A subtle hint displays: *"Save this lesson to unlock broadcast studio voice conversion."*

### 2. When Viewing a Saved Lesson (in "Saved Lessons" or immediately after saving)
An admin voice action banner appears:

- **State A: Never Converted (`audio_status === 'none'`)**:
  - Button: `🎙️ Convert to Studio Voice (0/52 converted)`
  - Subtext: *"Generate high-fidelity, human-like narration for all paragraphs."*

- **State B: In Progress / Rendering**:
  - Live animated progress bar: `Rendering Paragraph 18 of 52... (35%)`
  - Button: `⏸️ Pause Conversion` (safely halts after the current paragraph).

- **State C: Interrupted / Partial (`audio_status === 'paused'` or incomplete)**:
  - Progress badge: `⚠️ Voice Conversion Paused • 24/52 paragraphs ready`
  - Primary button: `▶️ Resume Voice Conversion` (picks up at paragraph 25).
  - Secondary button: `🎧 Listen to Ready Paragraphs` (plays paragraphs 1–24 with studio voice, falls back to browser voice for remaining).

- **State D: Fully Converted (`audio_status === 'ready'`)**:
  - Badge: `✨ Studio Voice Ready (52/52 Paragraphs Cached)`
  - Toggle switch: `[● Studio Voice | ○ Browser Voice]`
  - Audio streams from Supabase CDN with zero regeneration latency.

---

## 6. Seamless Dual-Buffer Audio Player Engine

To ensure studio-quality playback across paragraph clips without jarring pauses:

### 1. Double-Buffering Preloader
```typescript
class DualBufferAudioQueue {
  private primaryPlayer: HTMLAudioElement = new Audio();
  private secondaryPlayer: HTMLAudioElement = new Audio();
  private activePlayerIndex: 0 | 1 = 0;

  // Preloads the next paragraph while current one is playing
  preload(url: string) {
    const nextPlayer = this.activePlayerIndex === 0 ? this.secondaryPlayer : this.primaryPlayer;
    nextPlayer.src = url;
    nextPlayer.preload = 'auto';
  }

  // Switches to preloaded player with natural 350ms breathing pause
  transitionToNext(onStart: () => void) {
    setTimeout(() => {
      this.activePlayerIndex = this.activePlayerIndex === 0 ? 1 : 0;
      const player = this.activePlayerIndex === 0 ? this.primaryPlayer : this.secondaryPlayer;
      player.play();
      onStart();
    }, 350);
  }
}
```

### 2. YouTube Co-Existence & 1-Click Paragraph Resume
- When an inline YouTube track is played, `DualBufferAudioQueue` immediately pauses.
- When the song finishes, each paragraph card displays a `▶️ Play from here` button.
- Clicking any paragraph instantly loads that segment's audio clip and resumes playback from that exact point.

---

## 7. Implementation Checklist

- [x] **Supabase Storage**: Create `lesson-audio` public bucket with RLS policies allowing public read and authenticated write.
- [x] **Database Migration**: Add `audio_status`, `audio_voice`, and `audio_segments` columns to `public.lessons`.
- [x] **Storage Helpers (`lib/supabase.ts`)**: Implement `uploadLessonAudioSegment()` and `updateLessonAudioMetadata()`.
- [x] **Voice Generation Route (`app/api/lessons/audio/route.ts`)**:
  - SSE streaming endpoint with `start`, `resume`, and `pause` actions.
  - Sequential paragraph conversion with immediate database updates after each segment.
- [x] **Frontend Trigger Controls (`components/LessonPlayer.tsx`)**:
  - Restrict voice conversion button to **saved lessons only**.
  - Add "Convert to Studio Voice" and "Resume Voice Conversion" buttons with live progress feedback.
- [x] **Dual-Buffer Audio Engine**: Implement preloading queue with auto-scroll and 1-click paragraph seeking.
- [x] **Rate Limit & Quota Auto-Pause**: Detect Gemini HTTP 429 and `RESOURCE_EXHAUSTED` responses; parse and format the suggested wait duration (e.g. `~39 seconds` or `17 hours, 14 seconds`), pause conversion, safeguard all converted audio segments in Supabase, and present an in-UI resume notice.

