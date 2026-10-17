# New Feature Specification: Lessons

## 1. Overview & Navigation
- **Header Button**: A button labeled **"Music Lessons"** appears in the top navigation header next to the "unlock/admin" button.
- **Visibility**: The button is **always visible to everyone**, including non-admin visitors.
- **Behavior**: Clicking the button opens `/lessons` in a new browser tab.
- **Admin Session Sync**: Admin authentication is stored in `localStorage` (rather than tab-isolated `sessionStorage`) so that opening `/lessons` in a new tab preserves the active admin session. In addition, an unlock button/modal is available directly on `/lessons` if the user is not yet authenticated.

---

## 2. Page Structure (`/lessons`)
The `/lessons` route contains two main tabs:

### Tab 1: "Saved Lessons"
- **Access**: Publicly accessible to all users (both guests and admin).
- **Features**:
  - Displays a list of all previously saved lessons ordered by creation date.
  - Users can click on any saved lesson to read the full podcast-style lesson and listen to it via Text-to-Speech (TTS).
  - No need to edit or delete saved lessons.

### Tab 2: "Music Podcasts"
- **Access**: Restricted to admin mode only.
- **Non-admin Behavior**: If accessed while not in admin mode, displays a message indicating that admin privileges are required, along with an option/button to unlock admin mode.
- **Admin Behavior**: Displays a form with a text field asking the user to describe what they would like to learn about music, and a **"Send"** button.

---

## 3. Gemini Generation & Prompting

### Initial Generation
When the user clicks "Send", a request is sent to the Gemini API using the following prompt template:

> "You are a world music expert. The user wants to learn about the following: '{USER_PROMPT}'. First, return a short, direct, no-nonsense Lesson Title derived from the user query (maximum 5 to 8 words, strictly NO fluff, dramatic metaphors, or clickbait; formatted as an h1 tag at the very top: # Lesson Title). Then return a detailed lesson that reads like a spoken podcast. There must be an introduction, a main body divided into chapters with bold titles as h2 tags, and a conclusion. Within the text, whenever a song is discussed or referenced, insert the song organically into the narrative as a podcaster would introduce it (title, band name, year), accompanied by its YouTube link right there in the text (e.g. [Play "Song Title" by Artist on YouTube](https://www.youtube.com/results?search_query=Artist+Song+Title)). Do NOT put songs in a separate list at the end—embed each song and its link right within the chapter where it is discussed.
> 
> CRITICAL SCRIPT RULES FOR SPOKEN TEXT:
> - Write purely spoken narration meant to be read directly aloud by a voice synthesizer.
> - Do NOT include sound effect directions, musical cues, or stage directions (e.g. absolutely NO '(Intro music fades in...)', '(Drum roll)', or '[Applause]').
> - Do NOT include speaker or script labels (e.g. absolutely NO '**Host:**', 'Host:', or 'Narrator:')."

### Lesson Title Display & Storage
- **Format**: Short, direct, and informative (maximum 5–8 words). No clickbait, dramatic adjectives, or metaphors.
- **UI Presentation**: The title is extracted and showcased nicely at the top of the lesson as a prominent, stylish hero heading.
- **Saved Lessons List**: Each card in the "Saved Lessons" tab prominently displays this title along with creation date and prompt excerpt.
- **Persistence**: The extracted title is saved directly into the `title` column of the `lessons` table in Supabase.

### In-Page Playable YouTube Tracks (No External Redirects)
- **Inline Placement**: YouTube song links are placed directly inside the text where the podcaster introduces them (e.g. right after mentioning Bob Dylan's "Blowin' in the Wind"), rather than gathered at the end.
- **Playable Inside the Page**: Songs must be playable directly within the lesson page (via an embedded player/iframe) without redirecting or navigating away to the YouTube website.
- **Search Query Resolution**: Since YouTube iframe embeds require exact video IDs (and reject search query embeds), search links (`https://www.youtube.com/results?search_query=...`) are automatically resolved via a dedicated backend endpoint (`/api/youtube/search`) to the first matching video ID so the top video plays directly in the embedded player.

### Suggest Changes Loop
Below the generated lesson, two action buttons are shown:
1. **"Save Lesson"**: Saves the lesson (including its title, content, and original prompt) to the database and adds it to the "Saved Lessons" tab.
2. **"Suggest Changes"**: Opens a text field for user feedback/suggestions. On sending suggestions, the prompt sent to Gemini is:
   > "You are a world music expert. You helped the user with his original intent '{ORIGINAL_USER_PROMPT}', you returned '{PREVIOUS_RETURNED_LESSON}', now the user wants to '{USER_SUGGESTION}'. Return the modified lesson, maintaining a short, direct, no-nonsense top # Lesson Title (maximum 5-8 words, no fluff or clickbait), format, tone, structure, and inline YouTube song links placed within the text. Adhere strictly to the spoken text rules: no sound cues/directions and no speaker labels."
- The generated response replaces the current lesson, updates the displayed title, and the **"Save Lesson"** / **"Suggest Changes"** buttons reappear for further iterations.

---

## 4. Text-to-Speech (TTS) & Audio Playback
- **Engine**: Browser-native **Web Speech API** (`window.speechSynthesis`). Zero additional latency, no extra API keys, and fully client-side.
- **Spoken Text Sanitization**: The text-to-speech engine strips any parenthetical sound cues (e.g. `(intro music...)`, `[music fades]`) and speaker labels (`**Host:**`) so that only clean, natural narration is read aloud.
- **"Resume from here" Buttons**: Rendered exclusively at the start of each paragraph, nowhere else.
- **Playback & Song Coordination**:
  - Clicking "Resume from here" at any paragraph reads continuously from that paragraph through to the end.
  - Floating playback controls allow the user to **Pause**, **Resume**, and **Stop** playback at any time.
  - When the user plays an inline YouTube song, TTS automatically pauses so the user can listen to the music track uninterrupted.
  - After listening to a song, the user can click "Resume from here" at the following paragraph to continue listening to the podcast.
  - Visual highlighting indicates the paragraph currently being spoken.

---

## 5. Database Schema (Supabase)
A `lessons` table is added to Supabase:
```sql
CREATE TABLE IF NOT EXISTS public.lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    topic_prompt TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access to lessons" ON public.lessons FOR SELECT USING (true);
CREATE POLICY "Allow public insert access to lessons" ON public.lessons FOR INSERT WITH CHECK (true);
```
