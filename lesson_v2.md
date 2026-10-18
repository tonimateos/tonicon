# Specification: Music Lessons v2 — Long-Form Deep-Dive Podcasts

## 1. Goal & Vision
Upgrade the lesson generation pipeline to produce **long-form, broadcast-grade educational music podcasts** that are roughly **10x more detailed and comprehensive** than v1:
- **Length**: ~5,000 to 8,000+ words (equivalent to a 30–45 minute spoken audio episode).
- **Historical Context & Underlying Reasons**: In-depth exploration of *why* and *how* the musical movement, scene, or artist emerged when and where they did. This uncovers the socio-political climate, economic conditions, generational rebellions, geographic migrations, and technological breakthroughs (e.g. affordable magnetic tape, cheap synthesizers, electric amplification, pirate radio, club sound systems) that sparked the sound.
- **Deep Artist Spotlights**: When an influential artist or group is introduced, the narration pauses to explore their origin, instrumental rig, creative philosophy, key collaborators, and personal journey rather than a cursory one-sentence mention.
- **Substantive Musicological Analysis**: Accessible breakdown of rhythmic patterns, scales, harmonic structures, production techniques, and studio innovations (e.g., tape delay, motorik beats, distortion pedals, polyrhythms).
- **Rich Organic Discography**: 5 to 12+ songs organically introduced and embedded directly within the text with in-page playback. While Phase 1 plans key anchor tracks, Phase 2 grants Gemini full creative freedom to introduce additional songs by the spotlighted artists whenever helpful to illustrate stylistic shifts, comparisons, or breakthroughs.

---

## 2. Core Architecture: Hierarchical Multi-Step Generation (Producer → Chapter Writer Pipeline)

Single-prompt generation cannot reliably produce 8,000 words because LLMs naturally summarize after ~1,000 words and risk HTTP gateway timeouts. V2 implements a **two-phase hierarchical architecture**:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. The Podcast Producer (Curriculum Architect)              │
│    Analyzes user prompt -> Returns structured JSON outline  │
│    (Episode Title, Intro Brief, 5-8 Chapter Dossiers)       │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ 2. Chapter Writer Calls      │        │ 3. Streaming & Live UX       │
│    - Intro Call (~600w)      │ ───►   │    Live progress stepper:    │
│    - Chapter 1 (~1,000w)     │        │    [✓ Outline Created]       │
│    - Chapter 2 (~1,000w)     │        │    [✓ Ch 1: Early Roots]     │
│    - ...                     │        │    [Writing Ch 2: Artist...] │
│    - Chapter N (~1,000w)     │        │    Real-time chapter display │
│    - Outro Call (~600w)      │        └──────────────────────────────┘
└──────────────┬───────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Master Lesson Assembly & Persistence                     │
│    Stitches full markdown document (6,000-8,500 words)      │
│    Stores in Supabase with chapter metadata                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Phase Breakdown & Prompt Specifications

### Phase 1: The Podcast Producer (Outline & Dossier Generation)
A fast, structured call that plans the entire narrative arc before writing begins. Executed securely on the server inside `lib/gemini.ts` during the existing `POST /api/lessons/generate` request.

* **Internal Server Function**: `planLessonCurriculum(userPrompt)`
* **Prompt Structure**:
  > "You are an elite music historian, ethnomusicologist, and podcast executive producer. The listener wants an exhaustive, deep-dive podcast episode on: '{USER_PROMPT}'.
  >
  > Plan a master-class podcast episode consisting of an introduction, 5 to 7 extensive chapters, and a conclusion.
  >
  > Return a strict JSON object with this exact structure:
  > - `title`: Short, punchy, direct episode title (maximum 5-8 words, no fluff or clickbait).
  > - `intro`: Brief hook, cultural setting, thesis of the episode.
  > - `chapters`: Array of chapter objects:
  >   - `chapter_number`: Integer (1, 2, ...).
  >   - `title`: Chapter title (descriptive and evocative).
  >   - `historical_context_reasons`: Societal backdrop, cultural catalysts, or economic/political tensions driving this chapter's developments.
  >   - `artist_spotlight`: Name of the primary artist or band featured, their background, instrumental setup, and artistic impact to explore.
  >   - `musical_theory_focus`: Specific sound design, rhythm, scales, or studio techniques to dissect in this chapter.
  >   - `featured_song`: { `title`: string, `artist`: string, `year`: string, `narrative_context`: why this track exemplifies the chapter }
  >   - `key_talking_points`: Array of 4-5 bullet points the chapter must cover in depth.
  > - `conclusion`: Summary of legacy, ripple effects on modern music, and final thoughts."

### Phase 2: Chapter-by-Chapter Deep Writer
Each chapter is written in a dedicated generation call, granting the model 100% of its token budget and attention to develop deep context without rushing.

* **Target Word Count per Chapter**: ~800 to 1,200 words.
* **Context Passed**:
  1. Episode Title and overall theme.
  2. Summary of the immediately preceding chapter (for seamless narrative bridges).
  3. The current chapter dossier (historical context/reasons, artist, musical focus, song, talking points).
* **Prompt Structure**:
  > "You are the charismatic world-expert host of this music podcast.
  > Episode: '{EPISODE_TITLE}'.
  > You are speaking Chapter {N}: '{CHAPTER_TITLE}'.
  >
  > YOUR MANDATE FOR THIS CHAPTER:
  > - Unpack the historical context & reasons: explain why this sound emerged in this specific time and place (socio-economic conditions, counterculture, technology, migration, or community scene).
  > - Dedicate significant time to the artist spotlight: {ARTIST_SPOTLIGHT}. Explain their upbringing, their instruments/gear, their struggle, and their mindset.
  > - Break down the musical theory and production: {MUSICAL_THEORY_FOCUS}. Make technical musical concepts vivid and engaging for a listener.
  > - **Track Curation & Freedom to Add Songs**: Introduce the primary planned track: [Play '{SONG_TITLE}' by {SONG_ARTIST} on YouTube](https://www.youtube.com/results?search_query={SEARCH_QUERY}) and analyze its specific moments, riffs, or rhythms.
  >   - **Add More Songs if Thought Necessary**: If you feel it helps illustrate the artist's range, evolution, or a pivotal contrast, you are expressly encouraged to introduce 1 or 2 *additional* songs by this artist (or their close collaborators/influences). Every additional song must also be embedded organically with its YouTube search query link: `[Play 'Song Title' by Artist on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title)`.
  > - Cover all chapter talking points thoroughly: {TALKING_POINTS}.
  > - Target length: 900 to 1,200 words for this chapter alone.
  >
  > CRITICAL SPOKEN RULES:
  > - Pure spoken narration for text-to-speech.
  > - Absolutely NO sound directions: no '(Intro music fades)', no '[Applause]', no '(Drum fill)'.
  > - Absolutely NO speaker labels: no '**Host:**', no 'Host:'.
  > - Do NOT write a conclusion or wrap up the episode in this chapter; end with a natural bridge to the next topic."

### Phase 3: Assembly & Validation
Once all chapters are generated:
- Concatenate into standard Markdown: Top `# Title`, followed by `## Chapter Title` for each section, inline YouTube links, and conclusion.
- Validate that all required song links are intact with working search query parameters.
- Calculate metadata: total word count, estimated reading/listening time (`words / 150 wpm`).

---

## 4. User Experience: Real-Time Transparency & Progressive Display

Generating 7,000+ words across multiple steps takes ~30 to 45 seconds total. Instead of showing a static loading spinner, **the user sees every return from Gemini as it happens, with complete transparency into what Gemini is doing at every moment.**

### 1. Real-Time "What Gemini is Doing" Status Indicator
A prominent, animated status banner dynamically communicates the exact operation Gemini is performing:
- **During Outline Generation**:
  - `🧠 Gemini is planning the episode: structuring 6 chapters, selecting key artists, and curating songs...`
- **When Outline Lands**:
  - `✓ Syllabus created! Gemini is now writing Chapter 1/6: 'Foundations of the Sound' (exploring historical context & early scene)...`
- **During Each Chapter Call**:
  - `✍️ Gemini is writing Chapter 3/6: 'The Motorik Breakthrough' (analyzing Jaki Liebezeit's rhythm & tape manipulation)...`
- **When a Chapter Returns**:
  - `⚡ Chapter 3 received (1,140 words). Starting Chapter 4: 'Ambient Landscapes & Berlin School' (spotlighting Klaus Schulze)...`
- **Final Assembly**:
  - `✨ Stitching full 7,200-word master episode and verifying inline YouTube links...`

### 2. Immediate Display of Every Gemini Return (Progressive Rendering)
The user never has to wait for the entire 8,000-word script to finish before seeing results:
- **Return 1 — The Episode Outline Card (lands in ~2–3s)**:
  - As soon as Gemini finishes Phase 1, the user immediately sees a sleek **"Episode Syllabus"** card showcasing:
    - Extracted Episode Title.
    - Planned chapter titles with their spotlighted artists and designated tracks.
    - Estimated total listening duration.
- **Returns 2 to N — Progressive Chapter Reveal (lands every ~4–6s)**:
  - The moment Gemini returns a chapter's text, it is rendered immediately on the page with a smooth slide-in animation.
  - The user can already start reading Chapter 1 while Gemini is actively writing Chapters 2 and 3 in the background.
  - Each completed chapter card displays its live metrics: e.g. `✓ Chapter 2 Ready • 1,080 words • 1 Featured Song`.

### 3. Visual Chapter Stepper & Progress Checklist
A compact visual tracker displayed alongside the generation:
- `🟢 Chapter 1: Post-War Roots & Cultural Tension` — **✓ Completed (1,050 words)**
- `🟡 Chapter 2: The Studio as an Instrument` — **Writing with Gemini...**
- `⚪ Chapter 3: The Krautrock Pioneers & Motorik Beats` — **Queued**
- `⚪ Chapter 4: Synthesizer Revolutions & Berlin School` — **Queued**
- `⚪ Chapter 5: Global Legacy & Ripple Effects` — **Queued**
- `⚪ Conclusion: The Unbroken Thread` — **Queued**

### 4. Technical Mechanism: Server-Sent Events (SSE) Streaming
The existing `POST /api/lessons/generate` endpoint streams JSON chunks over a standard `ReadableStream` (SSE):
1. Event `{"type": "status", "message": "Planning syllabus..."}`
2. Event `{"type": "outline", "data": { title, chapters: [...] }}` → Frontend renders outline preview card.
3. Event `{"type": "status", "message": "Writing Chapter 1: ..."}`
4. Event `{"type": "chapter", "chapterIndex": 0, "chapter": { title, text, wordCount }}` → Frontend immediately appends Chapter 1 to the page.
5. Event `{"type": "complete", "lesson": { id, title, content }}` → Generation complete, saves to Supabase.

---

## 5. Resilient Build Persistence ("Current Building of the Podcast") & Resume Workflow

Generating a comprehensive 8,000-word lesson over multiple chapters takes significant time and tokens. **No work must ever be lost** if a connection drops, a browser tab closes, a server glitch occurs, or the user navigates away.

### 1. Dedicated Database Table: `active_lesson_build`
A designated table in Supabase stores the state of the podcast currently in progress:

```sql
CREATE TABLE IF NOT EXISTS public.active_lesson_build (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_prompt TEXT NOT NULL,
    title TEXT,
    outline_json JSONB,                       -- Episode syllabus & chapter dossiers from Phase 1
    chapters_json JSONB DEFAULT '[]'::jsonb,  -- Array of completed chapters as they land
    content TEXT DEFAULT '',                   -- Accumulated master Markdown text so far
    status TEXT NOT NULL DEFAULT 'in_progress',-- 'in_progress' | 'completed' | 'paused'
    current_step TEXT,                        -- e.g. "writing_chapter_3"
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE public.active_lesson_build ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public all access to active_lesson_build" ON public.active_lesson_build FOR ALL USING (true) WITH CHECK (true);
```

### 2. Step-by-Step Progressive Database Saving
As the pipeline progresses, the backend updates `active_lesson_build` in real time:
1. **On Prompt Sent**: Row is created with `topic_prompt`, `status: 'planning'`.
2. **On Outline Landed**: Row is updated with `title` and `outline_json`.
3. **On Each Chapter Return**: The server immediately appends the new chapter object into `chapters_json` and appends its formatted text into `content`.
4. **On Completion**: Row is marked `status: 'completed'`.

### 3. Automatic Detection & Resume upon Visiting `/lessons`
When an admin navigates to `/lessons` (or opens the "Music Podcasts" generation tab):
- The page queries for an existing active draft (`GET /api/lessons/draft`).
- **If an active build exists**:
  - The UI immediately loads and renders the state from the database.
  - Displays the outline and all chapters generated so far.
  - If the build was interrupted midway (e.g. 2 out of 5 chapters completed before a disconnect), a prominent **"Resume Generation"** button lets the user pick up generation from Chapter 3 without re-generating earlier chapters.
  - If generation had fully finished, the user can immediately read, listen via TTS, or click **"Save Lesson"** (which persists it permanently to `public.lessons` and clears the active build).

### 4. "Create New" Confirmation & Deletion Safeguard
To prevent accidental data loss:
- If an active draft exists in `active_lesson_build` and the user attempts to enter a new prompt or clicks **"Create New Podcast"**:
  - An explicit modal warning pops up:
    > **⚠️ Unfinished Podcast in Progress**
    >
    > You have a podcast currently being built: **"{title or topic_prompt}"** with {N} chapters completed.
    >
    > Starting a new podcast will permanently discard this work. Are you sure you want to discard it?
    >
    > `[ Keep Current Draft ]` &nbsp;&nbsp;&nbsp;&nbsp; `[ Discard & Start New ]`
  - Only if the user confirms **"Discard & Start New"**:
    - The backend calls `DELETE /api/lessons/draft` (clearing the `active_lesson_build` row).
    - The UI resets to a fresh, blank prompt field.

---

## 6. Lesson Player Upgrades for Long-Form Content

A 7,000-word lesson requires enhanced navigation tools:

### 1. Sticky Table of Contents / Chapter Drawer
- A floating or sidebar drawer listing all chapters with their featured artists and song titles.
- Clicking any chapter smoothly scrolls the page and jumps TTS speech directly to that chapter.

### 2. Header Episode Stats
- Prominent badge displaying:
  - `⏱ ~38 min listen`
  - `📖 6,800 words`
  - `🎵 7 Featured Tracks`
  - `🎙 6 Chapters`

### 3. Smart TTS Auto-Scroll & Paragraph Tracking
- As `window.speechSynthesis` speaks paragraph by paragraph, the page automatically scrolls smoothly to keep the active highlighted paragraph centered on the screen.
- Skip Chapter forward / backward buttons added to the floating bottom player bar.

### 4. Resilient In-Page Video Player (Carried from v1)
- Privacy-enhanced embed domain (`youtube-nocookie.com`).
- Automatic Brave browser detection (`navigator.brave.isBrave()`) defaulting to Click-to-Play mode so Brave users enjoy unmuted sound.
- TTS auto-cancels when a song starts, with a one-click "Resume from here" button on subsequent paragraphs.

---

## 7. Targeted Refinement Loop (Chapter-Level & Global)

Refining an 8,000-word lesson via "Suggest Changes" in one shot could truncate text or erase details. V2 introduces two refinement modes:

1. **Global Refinement**: For overarching changes (e.g. *"Shift the focus more towards Caribbean migration impact"*). Re-runs Phase 1 outline and regenerates affected chapters.
2. **Chapter-Level Refinement**: An edit/refine icon next to each chapter heading allowing the user to say:
   - *"In this chapter, spend more time explaining the drummer's specific technique and add an extra track."*
   - Only that specific chapter (~1,000 words) is re-prompted and hot-swapped into the master document.

---

## 8. Implementation Checklist (When Triggered)

- [ ] **Database**: Create `active_lesson_build` table in Supabase with RLS policies.
- [ ] **Draft API**: Add endpoints (`GET /api/lessons/draft`, `DELETE /api/lessons/draft`) to query and clear the active building state.
- [ ] **Lib**: In `lib/gemini.ts`, implement `planLessonCurriculum` and `generateLessonChapter` with progressive database updates on each chapter return.
- [ ] **Backend**: Upgrade `POST /api/lessons/generate` in `app/api/lessons/generate/route.ts` to stream progress and support resuming from a specific chapter.
- [ ] **Frontend**: In `app/lessons/page.tsx`:
  - Auto-check and restore `active_lesson_build` on mount.
  - Implement "Resume Generation" for interrupted builds.
  - Add "Discard & Start New" confirmation modal before overwriting an active draft.
  - Display the live generation stepper (`[✓ Syllabus Planned] → [Writing Chapters...]`).
- [ ] **Player**: Add Chapter Table of Contents sidebar and reading time badge to `components/LessonPlayer.tsx`.
- [ ] **Auto-scroll**: Implement active-paragraph viewport tracking during TTS playback.
