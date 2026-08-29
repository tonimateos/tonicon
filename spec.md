# A new route in the URL to discover new events

The goal of this new tab is to help me discover new cultural events (such as concerts, meetups, theaters, expositions) by:

- understanding my preferences
- scrapping a set of URLs where I normally get info about different events
- selecting those that may match my preferences
- for every selected potential match, ask if I'm interested
- if interested, add it to a list of future event's I'm interested
- if not interested, ask why, and use the answer to refine the preferences.


# Details

- It must be accessible at a different route than the concerts page (at `/discover`). It is a self-contained application entirely isolated within `/discover` (interested events remain strictly on `/discover`'s Interested tab, with no connection or importing to the Concerts page), co-located in the same project to save deployment costs.
- It must be minimal.
- The main use of in desktop, no need for great mobile experience
- There is a tab with the functionality to add and remove URLs I want to get my events from.
- The process of scraping is started on demand per source URL. Upon clicking "Scrape & Discover", a debug modal opens immediately displaying real-time extraction status, including the **precise URL currently being scraped** (both main agenda page and individual event detail sub-pages).
- Each extracted event entry populates its `event_url` field with its full absolute detail link. The crawler automatically visits each event's sub-page URL to extract deep event details (such as door times, start times, ticket prices, descriptions, and ticket seller links) and merges them into the raw JSON entry in real-time.
- Next to each source URL, a "Past JSON" button allows viewing the previously stored JSON, and a "Clear JSON" button allows deleting the stored JSON for that source. A "Clear Stored JSON" button is also provided inside the debug modal.
- When re-scraping a source, Gemini automatically skips events or sub-URLs that are already present in the previously stored JSON.
- The extracted JSON is presented to the user with a prompt to either "Send to LLM for Match Filtering" or "Cancel", aiding in debugging events that were missed or misclassified.
- Events that are already in the list of upcoming events are discarded from potential new matches.
- Potential matches are presented as a list of proposed cards, where each card has "Yes" / "No" buttons and provides the info required to make a decision, such as:
    - Event Name
    - Venue location, ideally clickable, opening a Google Maps new tab.
    - Date
    - A link to the event
    - A button to say "Yes" or "No" to I'm interested
    - On click on "No", a field opens to ask why. The user has the option to skip providing the reason, in which case, the proposal is just rejected, and no new reason is created or added to the preferences. 
    - On click on "Yes", the event is added to the list of upcoming events.
    

- There is a way to access the current preferences, which is basically a text that can contain many things. For example, a copy-pasted set of songs from a Spotify playlist, so my music taste is known. Also, my own wording for preferences on music, cultural events, etc. A way to edit these preferences manually, including modyifing and adding to them.

- When saying No to an event, the event details and reason (e.g. "Too expensive", "Don't like this venue", "Wrong music genre") are sent to Gemini, which produces a suggested extra preference rule (for example, if the reason is "Too expensive", Gemini suggests something like "The user considers an event of type [THIS TYPE] too expensive") that is presented to the user for confirmation before saving.

- A tab where I can see the upcoming events I'm interested in, and one for those already past.


# Architecture

- Like the main concerts code:
    - Next.js as framework full-stack (React for frontend and API Routes in Node.js for backend).
    - Supabase DB as external database (preferences, events, etc.)
- DigitalOcean App as server deployment.
- Gemini API key (`GEMINI_API_KEY`) and default model (`GEMINI_MODEL=gemini-2.0-flash`) configured in `.env` / `.env.local`.

