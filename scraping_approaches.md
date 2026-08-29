# Web Scraping Architecture & Alternatives

This document analyzes the current web scraping implementation for cultural event discovery in **Tonicon** and presents alternative approaches to improve reliability, speed, token efficiency, and deep metadata extraction (such as music genres, band descriptions, ticket info, and event categories found in sublinks).

---

## 1. Overview of the Problem

When discovering cultural events from venue or calendar pages (e.g., `https://lanaubarcelona.es/en/agenda`), extracting accurate metadata requires examining **both**:
1. **The Main Agenda Page**: Contains dates, artist titles, and links to event detail pages.
2. **Event Detail Sublinks**: Contain essential metadata not present on the main calendar, such as:
   - Band/Artist genre (e.g., Rock, Indie, Trap, Brazilian Forró, Electronic, Jazz).
   - Event descriptions, lineups, opening acts, and supporting artists.
   - Specific schedule details (door opening times vs. showtime).
   - Ticket prices, seller links, and age restrictions.

---

## 2. Current Implementation Analysis

### Strategy
1. **HTML Pruning**: Loads raw HTML with Cheerio and strips `<script>`, `<style>`, `<nav>`, `<header>`, `<footer>`, `<svg>`, and `<picture>`.
2. **Text Flattening**: Extracts `$('body').text()`, collapsing whitespace, and truncates to 15,000 characters.
3. **Main Page LLM Extraction**: Sends the pruned text to Gemini (`gemini-2.5-flash`) to identify event titles and sublink URLs (`event_url`).
4. **Iterative Deep Crawl**: Loops sequentially through each discovered `event_url`, fetches the detail page, prunes its HTML, and sends it to Gemini to extract extra fields.

### Disadvantages & Pain Points
- **Loss of HTML Link Structure**: Flattening `$('body').text()` strips `<a>` tags and CSS classes. Gemini must reconstruct links from plain text snippet context, which can miss sublinks or misassociate them.
- **Over-Pruning Risk**: Stripping `<header>` or `<nav>` or structural tags can accidentally discard category tags or genre breadcrumbs on WordPress themes.
- **High Sequential Latency & Cost**: Fetching and calling Gemini once per event detail page creates $N+1$ AI requests (e.g., 30 events = 31 LLM API calls).
- **Inconsistent Genre Extraction**: Plain text sent to Gemini might lack genre labels if genres were stored as CSS badge attributes or microdata.

---

## 3. Proposed Alternative Approaches

Below are 4 alternative architectures designed to optimize sublink extraction, genre discovery, speed, and AI cost.

---

### Alternative A: DOM Link Extractor + Batched Gemini Parsing (Recommended Short-Term)

#### How it Works
1. **Cheerio DOM Selection (No LLM needed for link finding)**: Use DOM parsing to explicitly extract all event containers and candidate detail `<a href="...">` links from the raw HTML structure.
2. **Extract Embedded Metadata Directly**: Extract CSS badges, category tags, data attributes (e.g. `<span class="genre">Indie Rock</span>`), and schema.org JSON-LD microdata directly via DOM code.
3. **Batched Sublink Fetching**: Concurrently fetch detail page HTML for all discovered sublinks (`Promise.all` with concurrency limit of 5).
4. **Single-Pass Batched LLM Prompt**: Combine all pruned detail page contents into a single structured prompt for Gemini, asking it to extract events + genres in 1 or 2 LLM calls instead of $N$ calls.

#### Pros
- **100% Reliable Sublink Discovery**: `<a>` tags are captured directly via DOM without relying on LLM text recognition.
- **Captured Genres & Categories**: CSS badges and category tags are preserved.
- **Speed**: Concurrent fetching (`Promise.all`) reduces total scraping time from 30s+ down to ~3–5s.
- **Drastically Lower Token Cost**: Reduces Gemini API calls from $N+1$ down to 1–2 requests.

#### Cons
- Requires basic DOM selector heuristics (e.g. looking for `<article>`, `.event`, `a[href*="/agenda/"]`).

---

### Alternative B: Structured Microdata (JSON-LD / OpenGraph) First + Web Scraping Fallback

#### How it Works
1. Most cultural agenda sites (WordPress, Eventbrite, DICE, Shotgun) embed structured JSON-LD schemas inside `<script type="application/ld+json">` tags representing `Event` or `MusicEvent` objects.
2. The scraper checks for `<script type="application/ld+json">` first:
   - Reads `name`, `startDate`, `location`, `genre`, `performer`, `description`, `offers.price`, and `url` with zero AI calls.
3. If JSON-LD is missing or incomplete, falls back to DOM Sublink Extraction (Alternative A).

#### Pros
- **Zero AI Cost & Instant Speed**: Standard events are extracted in milliseconds.
- **Perfect Precision**: Genres, start times, ticket URLs, and venue data are provided directly by the site creator.

#### Cons
- Only works on sites that implement Schema.org `Event` microdata (though ~60-70% of modern event venues use it).

---

### Alternative C: Two-Tier LLM Pipeline (Index Extraction -> Filtered Sublink Deep Crawl)

#### How it Works
1. **Tier 1 (Index Extraction)**: Send raw/lightly-pruned HTML (preserving `<a href>` tags and CSS classes) to Gemini to return a JSON list of event objects:
   ```json
   [
     { "event_name": "Dov'è Liana", "sublink": "https://lanaubarcelona.es/en/agenda/dove-liana", "genre_hint": "Indie Pop" }
   ]
   ```
2. **Filtering Check**: Compare `sublink` against previously stored JSON. Only fetch detail pages for **new or unclassified** events.
3. **Tier 2 (Targeted Genre/Bio Extraction)**: For unclassified events, fetch the detail page and prompt Gemini specifically:
   > *"Given the event page for [Artist], extract: (1) Music genre / style, (2) Artist bio summary, (3) Opening acts, (4) Ticket price."*

#### Pros
- Preserves full flexibility for sites without standard DOM layouts.
- Focuses AI tokens exclusively on genre discovery and event descriptions.

#### Cons
- Still uses LLM calls for index parsing, though much more focused than current implementation.

---

### Alternative D: Headless Browser / API Crawler (e.g. Firecrawl or Playwright)

#### How it Works
1. **What is a "Headless Browser"?**: Standard HTTP `fetch()` only downloads raw static text from a web server. But many modern agenda websites use JavaScript (React/Vue/Angular) to load events dynamically, or hide links behind click handlers. A "headless browser" runs a real Chromium browser program behind the scenes (without drawing a visible window on your screen). It executes JavaScript scripts, waits for event elements to load, and extracts sublinks cleanly.
2. **Firecrawl Service**: Firecrawl is a cloud API platform that runs these headless browsers for you. You pass it a main URL (e.g., `https://lanaubarcelona.es/en/agenda`), and Firecrawl automatically:
   - Opens the page in a real browser.
   - Crawls all event detail sublinks linked on that page.
   - Converts the rendered web page HTML into clean Markdown text preserving sublinks.
   - Returns a structured array of Markdown pages ready for Gemini to read.

#### Pros
- **Handles JavaScript-Heavy Sites**: Captures events on sites where standard HTML `fetch()` gets blank/empty pages due to client-side JS rendering.
- **Automated Link Resolution**: Automatically follows and resolves sublinks without requiring custom Cheerio CSS rules per website.
- **Clean Markdown Format**: Strips page clutter (ad banners, site footers) automatically.

#### Cons Explained
1. **External Third-Party Service Dependency (Firecrawl)**:
   - Requires registering an account with a commercial third-party SaaS provider (Firecrawl.dev) and adding a `FIRECRAWL_API_KEY` to your environment variables.
   - While they offer a free tier (e.g., ~500 pages/month), heavy usage requires a paid monthly subscription.
2. **High Memory Overhead if Self-Hosting (Playwright / Puppeteer)**:
   - If you choose *not* to use a paid API like Firecrawl and instead run your own local Chrome browser using Playwright on your server:
   - A real Chrome browser process requires 300MB – 600MB of RAM and heavy CPU resources.
   - Serverless platforms like Vercel or small cloud instances (e.g. 512MB RAM free servers) will crash or hit execution timeouts (10s limit on Vercel Hobby plan).

---

## 4. Comparison Summary Table

| Metric / Feature | Current Approach | Alternative A (DOM + Concurrent) | Alternative B (JSON-LD + Fallback) | Alternative C (Two-Tier LLM) | Alternative D (Firecrawl) |
|---|---|---|---|---|---|
| **Sublink Extraction Reliability** | Medium (Text-based) | **100% (DOM Link Selector)** | **100% (Structured Data)** | High (HTML Link-Aware) | High (Crawler Map) |
| **Genre & Band Type Precision** | Moderate | **High (Badge & Detail Parsing)** | **Very High (Schema.org)** | **Very High (Targeted Prompt)** | High |
| **Scraping Speed (30 Events)** | ~30 - 60 seconds | **~3 - 5 seconds** | **< 1 second** | ~8 - 12 seconds | ~5 - 10 seconds |
| **LLM Token & Request Count** | $N+1$ requests (~30 calls) | **1 - 2 requests** | **0 requests** (when microdata present) | 2 requests | 1 request |
| **Resilience to JS-Only Sites** | No | No | Partial | No | **Yes** |

---

## 5. Recommendation & Next Steps

1. **Adopt Alternative A (DOM Link Extractor + Batched Concurrent Sublink Parsing)**:
   - Use Cheerio to extract all `<a href="...">` links from candidate event blocks on the main agenda page.
   - Fetch sublink detail pages concurrently using `Promise.all`.
   - Extract genre badges and microdata directly from detail HTML, sending the consolidated text to Gemini in a single pass.
2. **Incorporate Alternative B (JSON-LD Auto-Detector)**:
   - Check if `<script type="application/ld+json">` exists on the main agenda or detail subpages to extract genre, artist, date, and price instantly.
