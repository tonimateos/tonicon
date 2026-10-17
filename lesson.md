# New Feature Specification: Lessons

## 1. Overview & Navigation
- **Header Button**: A button labeled **"Add Lesson"** (or **"Lessons"**) appears in the top navigation header next to the "unlock/admin" button.
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

### Tab 2: "Add Lesson"
- **Access**: Restricted to admin mode only.
- **Non-admin Behavior**: If accessed while not in admin mode, displays a message indicating that admin privileges are required, along with an option/button to unlock admin mode.
- **Admin Behavior**: Displays a form with a text field asking the user to describe what they would like to learn about music, and a **"Send"** button.

---

## 3. Gemini Generation & Prompting

### Initial Generation
When the user clicks "Send", a request is sent to the Gemini API using the following prompt template:

> "You are a world music expert. The user wants to learn about the following: '{USER_PROMPT}'. Return a detailed lesson that looks like a long podcast. There must be an introduction, a main body divided into chapters with bold titles as h2 tags, and a conclusion. Within the text, insert songs (title, band name, year) as they are referenced in the lesson. Add a section at the end where you list the songs and bands that were mentioned in the lesson, with their respective Spotify and YouTube links."

### Song Links (Spotify & YouTube)
To prevent broken/hallucinated URLs from LLM output, links are formatted as direct search queries:
- **Spotify**: `https://open.spotify.com/search/[Artist%20Song]`
- **YouTube**: `https://www.youtube.com/results?search_query=[Artist%20Song]`

### Suggest Changes Loop
Below the generated lesson, two action buttons are shown:
1. **"Save Lesson"**: Saves the lesson to the database and adds it to the "Saved Lessons" tab.
2. **"Suggest Changes"**: Opens a text field for user feedback/suggestions. On sending suggestions, the prompt sent to Gemini is:
   > "You are a world music expert. You helped the user with his original intent '{ORIGINAL_USER_PROMPT}', you returned '{PREVIOUS_RETURNED_LESSON}', now the user wants to '{USER_SUGGESTION}'. Return the modified lesson, trying to keep the same format, tone, and structure."
- The generated response replaces the current lesson, and the **"Save Lesson"** / **"Suggest Changes"** buttons reappear for further iterations.

---

## 4. Text-to-Speech (TTS) & Audio Playback
- **Engine**: Browser-native **Web Speech API** (`window.speechSynthesis`). Zero additional latency, no extra API keys, and fully client-side.
- **Listen Buttons**: Rendered at the beginning of the lesson and immediately after each song reference/link throughout the text.
- **Playback Behavior**:
  - Clicking a "Listen" button resumes reading continuously from that specific section through to the end.
  - Floating playback controls allow the user to **Pause**, **Resume**, and **Stop** playback at any time.
  - Visual highlighting indicates the section currently being spoken.

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
