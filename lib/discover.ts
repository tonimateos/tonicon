import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { supabase } from './supabase';
import { DiscoverEvent, DiscoverEventStatus, DiscoverPreferences, DiscoverUrl } from './types';

function getGeminiModel() {
  const rawKey = process.env.GEMINI_API_KEY || '';
  const apiKey = rawKey.replace(/^["']|["']$/g, '').trim();

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in .env.local');
  }

  const rawModel = (process.env.GEMINI_MODEL || '').replace(/^["']|["']$/g, '').trim();
  const modelName =
    rawModel && rawModel !== 'gemini-2.0-flash' && rawModel !== 'gemini-1.5-flash'
      ? rawModel
      : 'gemini-2.5-flash';

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName });
}

/**
 * Strips noise, script tags, styling, SVGs, headers/footers from raw HTML
 * to minimize token consumption before sending to Gemini.
 */
export function pruneHtml(html: string): string {
  if (!html) return '';

  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, noscript, svg, nav, footer, header, iframe, style, link, meta, picture, audio, video, form, input, button').remove();

  // Extract body text with minimal spacing
  let cleanText = $('body').text();

  // Collapse multiple whitespace/newlines
  cleanText = cleanText.replace(/\s+/g, ' ').trim();

  // Cap pruned text length (~15,000 chars max ~ 3,000 tokens)
  return cleanText.slice(0, 15000);
}

/**
 * Step 1 Debugging helper: Extracts ALL raw events from pruned HTML into structured JSON entries,
 * picking the schema fields that best adapt to that specific source.
 */
/**
 * Step 1 Debugging helper: Extracts ALL raw events from pruned HTML into structured JSON entries,
 * picking the schema fields that best adapt to that specific source.
 * If previousEvents are provided, Gemini skips events or sub-URLs already present in the previous JSON.
 */
export async function extractAllRawEventsFromHtml(
  prunedHtml: string,
  sourceUrl: string,
  previousEvents?: Array<Record<string, unknown>>
): Promise<Array<Record<string, unknown>>> {
  const model = getGeminiModel();

  const prevText =
    previousEvents && previousEvents.length > 0
      ? `\nPREVIOUSLY EXTRACTED EVENTS (SKIP THESE IF THEY ARE ALREADY KNOWN / UNCHANGED):\n${JSON.stringify(previousEvents.slice(0, 30), null, 2)}\n`
      : '';

  const prompt = `You are a raw event parser. Analyze the webpage text below and extract ALL events (concerts, meetups, exhibitions, plays, festivals) listed on this page, regardless of user preferences.
${prevText}
SOURCE WEBPAGE URL: ${sourceUrl}

WEBPAGE CONTENT:
${prunedHtml}

INSTRUCTIONS:
1. Extract every event listed on the page into a structured JSON array.
2. For each event, select the fields that best capture all details from this particular source (for example: "event_name", "artist_or_performer", "venue_name", "date_and_time", "price_or_ticket_info", "category_or_tags", "event_url").
3. Make sure to extract the direct detail link or ticket URL for each event if present on the page (into field "event_url").
4. If previously extracted events are listed above, do not duplicate them if they are unchanged. Focus on new or updated event entries.
5. Return ONLY a valid JSON array of objects. Do NOT wrap in markdown code fences or add conversational text.`;

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (parseErr) {
    console.error('Failed to parse raw extracted events JSON:', rawText, parseErr);
    throw new Error(`Gemini returned invalid JSON: ${rawText.slice(0, 200)}`);
  }

  return [];
}

export type ProgressCallback = (progress: {
  type: 'status' | 'event' | 'complete' | 'error';
  url?: string;
  message?: string;
  event?: Record<string, unknown>;
  rawEvents?: Record<string, unknown>[];
  skippedCount?: number;
}) => void;

/**
 * Alternative D DOM Crawler with Sublink Deduplication:
 * 1. Fetches main agenda URL and parses DOM using Cheerio.
 * 2. Discovers all event sublinks.
 * 3. Cross-references database to skip sublinks already crawled previously for this source.
 * 4. Deep-crawls remaining new sublinks to extract headings, descriptions, and page text.
 * 5. Saves newly crawled sublinks to database to prevent re-crawling in future runs.
 * 6. Reports progress via SSE callback (including total discovered, skipped count, and crawling steps).
 */
export async function extractAllRawEventsAlternativeD(
  sourceUrl: string,
  previousEvents?: Array<Record<string, unknown>>,
  onProgress?: ProgressCallback
): Promise<Array<Record<string, unknown>>> {
  onProgress?.({
    type: 'status',
    url: sourceUrl,
    message: `Fetching main webpage HTML: ${sourceUrl}`
  });

  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${sourceUrl}`);
  }

  const mainHtml = await res.text();
  const $main = cheerio.load(mainHtml);

  // 1. Discover all sublinks matching event patterns
  const discoveredLinks = new Set<string>();
  const parsedSourceUrl = new URL(sourceUrl);

  $main('a[href]').each((_, el) => {
    const href = $main(el).attr('href');
    if (!href) return;

    try {
      const absUrl = new URL(href, sourceUrl).href;
      const isEventLink =
        absUrl !== sourceUrl &&
        !absUrl.endsWith('#') &&
        !absUrl.includes('wp-login') &&
        !absUrl.includes('cart') &&
        !absUrl.includes('.png') &&
        !absUrl.includes('.jpg') &&
        !absUrl.includes('/ca/') &&
        !absUrl.includes('/es/') &&
        (absUrl.includes('/agenda/') ||
          absUrl.includes('/event/') ||
          absUrl.includes('/concierto/') ||
          absUrl.includes(parsedSourceUrl.hostname));

      if (isEventLink) {
        discoveredLinks.add(absUrl);
      }
    } catch {}
  });

  const allSublinks = Array.from(discoveredLinks);

  // 2. Fetch previously crawled sublinks from database
  const crawledSet = await getDiscoverCrawledSublinks(sourceUrl);

  const newSublinks: string[] = [];
  const skippedSublinks: string[] = [];

  for (const link of allSublinks) {
    if (crawledSet.has(link)) {
      skippedSublinks.push(link);
    } else {
      newSublinks.push(link);
    }
  }

  onProgress?.({
    type: 'status',
    url: sourceUrl,
    skippedCount: skippedSublinks.length,
    message: `Discovered ${allSublinks.length} sublinks. Skipped ${skippedSublinks.length} previously crawled link(s). ${newSublinks.length} new sublink(s) to crawl.`
  });

  const crawledSubpages: Array<Record<string, unknown>> = [];
  const newlyCrawledUrls: string[] = [];

  // Deep crawl new sublinks
  for (let i = 0; i < newSublinks.length; i++) {
    const sublink = newSublinks[i];
    onProgress?.({
      type: 'status',
      url: sublink,
      skippedCount: skippedSublinks.length,
      message: `Deep crawling new sublink (${i + 1}/${newSublinks.length}): ${sublink}`
    });

    try {
      const subRes = await fetch(sublink, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(12000),
        cache: 'no-store'
      });

      if (subRes.ok) {
        const subHtml = await subRes.text();
        const $sub = cheerio.load(subHtml);

        // Remove noise tags and cookie warnings
        $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

        // Extract headings
        const headings: string[] = [];
        $sub('h1, h2, h3').each((_, el) => {
          const text = $sub(el).text().trim();
          if (text) headings.push(text);
        });

        // Targeted extraction for full concert description paragraphs
        const descriptionParagraphs: string[] = [];
        $sub('.entry-content p, .event-description p, article p, main p, p').each((_, el) => {
          const text = $sub(el).text().trim();
          if (text && text.length > 15 && !text.includes('Utilitzem cookies') && !text.includes('cookie')) {
            descriptionParagraphs.push(text);
          }
        });

        const fullDescription =
          descriptionParagraphs.length > 0
            ? descriptionParagraphs.join('\n\n')
            : $sub('body').text().replace(/\s+/g, ' ').trim();

        const fullBodyText = $sub('body').text().replace(/\s+/g, ' ').trim();

        const item = {
          event_sublink_url: sublink,
          page_title: $sub('title').text().trim(),
          headings: headings.slice(0, 5),
          full_event_description: fullDescription,
          full_page_text: fullBodyText
        };

        crawledSubpages.push(item);
        newlyCrawledUrls.push(sublink);

        onProgress?.({
          type: 'event',
          url: sublink,
          event: item,
          skippedCount: skippedSublinks.length,
          message: `Crawled (${i + 1}/${newSublinks.length}): ${item.page_title}`
        });
      }
    } catch (err) {
      console.warn(`Failed to deep crawl sublink ${sublink}:`, err);
    }
  }

  // 3. Save newly crawled sublinks to database
  if (newlyCrawledUrls.length > 0) {
    await saveDiscoverCrawledSublinks(sourceUrl, newlyCrawledUrls);
  }

  // 4. Combine newly crawled subpages with existing cached subpage items for skipped sublinks
  const cachedSubpagesMap = new Map<string, Record<string, unknown>>();
  if (previousEvents && Array.isArray(previousEvents)) {
    for (const prevItem of previousEvents) {
      const url = (prevItem.event_sublink_url || prevItem.event_url || prevItem.url) as string;
      if (url) {
        cachedSubpagesMap.set(url, prevItem);
      }
    }
  }

  const combinedSubpages: Array<Record<string, unknown>> = [...crawledSubpages];
  for (const skippedUrl of skippedSublinks) {
    if (cachedSubpagesMap.has(skippedUrl)) {
      combinedSubpages.push(cachedSubpagesMap.get(skippedUrl)!);
    }
  }

  onProgress?.({
    type: 'status',
    url: sourceUrl,
    skippedCount: skippedSublinks.length,
    message: `Crawl complete. ${combinedSubpages.length} total subpages ready (${crawledSubpages.length} newly crawled, ${skippedSublinks.length} cached).`
  });

  return combinedSubpages;
}

/**
 * Deep Crawling Extractor:
 * 1. Fetches and parses main source URL.
 * 2. Extracts event listings with their event_url links.
 * 3. Crawls sub-URLs for each event detail page to retrieve full details.
 * 4. Reports live progress containing the PRECISE URL being scraped.
 */
export async function extractAllRawEventsWithDeepCrawl(
  sourceUrl: string,
  previousEvents?: Array<Record<string, unknown>>,
  onProgress?: ProgressCallback
): Promise<Array<Record<string, unknown>>> {
  // 1. Notify progress: Fetching main agenda page
  onProgress?.({
    type: 'status',
    url: sourceUrl,
    message: `Fetching main webpage: ${sourceUrl}`
  });

  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(15000),
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch URL ${sourceUrl} (HTTP status: ${res.status})`);
  }

  const rawHtml = await res.text();
  const pruned = pruneHtml(rawHtml);

  // 2. Notify progress: Parsing events from main page
  onProgress?.({
    type: 'status',
    url: sourceUrl,
    message: `Analyzing main page with Gemini to detect event listings & detail links...`
  });

  const baseEvents = await extractAllRawEventsFromHtml(pruned, sourceUrl, previousEvents);

  if (baseEvents.length === 0) {
    return previousEvents || [];
  }

  const enrichedEvents: Array<Record<string, unknown>> = [];
  const total = baseEvents.length;

  // 3. Deep crawl individual event detail URLs
  for (let i = 0; i < total; i++) {
    const item = { ...baseEvents[i] };
    let rawUrl = (item.event_url || item.url || item.link || item.event_link || '') as string;

    // Resolve relative URL against sourceUrl
    let detailUrl: string | null = null;
    if (rawUrl && typeof rawUrl === 'string' && rawUrl.trim().length > 0) {
      try {
        detailUrl = new URL(rawUrl.trim(), sourceUrl).href;
      } catch {
        detailUrl = null;
      }
    }

    // Ensure event_url field is populated with full absolute URL
    item.event_url = detailUrl || sourceUrl;

    // If detailUrl is a distinct sub-page (not identical to main sourceUrl), crawl it for deeper details!
    if (detailUrl && detailUrl !== sourceUrl) {
      onProgress?.({
        type: 'status',
        url: detailUrl,
        message: `Deep crawling event ${i + 1}/${total}: ${detailUrl}`
      });

      try {
        const detailRes = await fetch(detailUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          },
          signal: AbortSignal.timeout(10000),
          cache: 'no-store'
        });

        if (detailRes.ok) {
          const detailHtml = await detailRes.text();
          const $sub = cheerio.load(detailHtml);
          $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

          // Targeted extraction for full concert description paragraphs
          const descriptionParagraphs: string[] = [];
          $sub('.entry-content p, .event-description p, article p, main p, p').each((_, el) => {
            const text = $sub(el).text().trim();
            if (text && text.length > 15 && !text.includes('Utilitzem cookies') && !text.includes('cookie')) {
              descriptionParagraphs.push(text);
            }
          });

          if (descriptionParagraphs.length > 0) {
            item.event_description = descriptionParagraphs.join('\n\n');
          }

          const detailPruned = pruneHtml(detailHtml);

          if (detailPruned.length > 50) {
            const model = getGeminiModel();
            const detailPrompt = `You are a detailed event info extractor. Extract specific details for this single event from its official detail page text.

EVENT NAME / OVERVIEW:
${JSON.stringify(item, null, 2)}

DETAIL PAGE CONTENT (${detailUrl}):
${detailPruned.slice(0, 10000)}

INSTRUCTIONS:
1. Extract any additional specific details found on this detail page (e.g. "event_description", "music_genre", "door_time", "start_time", "exact_price", "age_limit", "ticket_seller_link", "lineup_details").
2. Ensure "event_description" captures the complete event/artist description text.
3. Merge these details into the existing event JSON structure.
4. Return ONLY a single valid JSON object containing the updated fields. Do NOT wrap in markdown code blocks.`;

            const detailResult = await model.generateContent(detailPrompt);
            const detailText = detailResult.response
              .text()
              .trim()
              .replace(/^```json\s*/i, '')
              .replace(/\s*```$/i, '');

            try {
              const mergedDetails = JSON.parse(detailText);
              if (mergedDetails && typeof mergedDetails === 'object' && !Array.isArray(mergedDetails)) {
                Object.assign(item, mergedDetails);
              }
            } catch (err) {
              console.warn(`Failed to parse detail JSON for ${detailUrl}:`, err);
            }
          }
        }
      } catch (crawlErr) {
        console.warn(`Could not deep crawl detail URL ${detailUrl}:`, crawlErr);
      }
    }

    enrichedEvents.push(item);
    onProgress?.({
      type: 'event',
      url: detailUrl || sourceUrl,
      event: item,
      message: `Extracted: ${item.event_name || 'Event'}`
    });
  }

  return enrichedEvents;
}

/**
 * Step 2: Evaluates raw extracted events against user preferences to find matches.
 */
export async function filterEventsWithPreferences(
  rawEvents: Array<Record<string, unknown>>,
  userPreferences: string,
  sourceUrl: string
): Promise<Array<{ event_name: string; venue_name?: string; date?: string; url?: string }>> {
  if (!rawEvents || rawEvents.length === 0) {
    return [];
  }

  const model = getGeminiModel();

  const prompt = `You are a cultural event match evaluator. Compare the following list of raw extracted events against the user's preferences.

USER PREFERENCES:
${userPreferences || 'No specific preferences specified. Select all reasonable cultural events.'}

RAW EXTRACTED EVENTS (JSON):
${JSON.stringify(rawEvents, null, 2)}

INSTRUCTIONS:
1. Filter and return ONLY the events from the list that match or align with the user's preferences.
2. Format each matching event into a standardized object with:
   - "event_name": string (Name of the event or artist)
   - "venue_name": string or null (Venue or location)
   - "date": string or null (ISO-8601 date string e.g. "2026-10-15T20:00:00Z" or "2026-10-15")
   - "url": string or null (Direct link if available, otherwise "${sourceUrl}")
3. Return ONLY a strict JSON array of matching objects. Do NOT wrap in markdown code blocks.`;

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => item && typeof item.event_name === 'string' && item.event_name.trim().length > 0);
    }
  } catch (parseErr) {
    console.error('Failed to parse Gemini match evaluation JSON:', rawText, parseErr);
  }

  return [];
}

/**
 * Uses Gemini to parse pruned HTML content against user preferences
 * and extract matching candidate events.
 */
export async function extractEventsWithGemini(
  prunedHtml: string,
  userPreferences: string,
  sourceUrl: string
): Promise<Array<{ event_name: string; venue_name?: string; date?: string; url?: string }>> {
  const model = getGeminiModel();

  const prompt = `You are a cultural event discovery assistant. Analyze the webpage text below and select cultural events (concerts, meetups, theaters, expositions, festivals) that match or align with the user's preferences.

USER PREFERENCES:
${userPreferences || 'No specific preferences specified yet. Select interesting cultural events, concerts, meetups, expositions, and theaters.'}

SOURCE WEBPAGE URL:
${sourceUrl}

WEBPAGE PRUNED CONTENT:
${prunedHtml}

INSTRUCTIONS:
1. Extract upcoming cultural events mentioned on the page that match or fit the user's preferences.
2. Return ONLY a strict JSON array of objects. Do NOT wrap in markdown code blocks or add explanatory text.
3. Each object in the array must have:
   - "event_name": string (Name of the event or performing artist)
   - "venue_name": string or null (Location or venue name)
   - "date": string or null (ISO-8601 date string e.g. "2026-10-15T20:00:00Z" or "2026-10-15". If year is missing, assume upcoming year 2026)
   - "url": string or null (Direct link to the event if found in text/URL, otherwise use source URL: "${sourceUrl}")

If no matching upcoming events are found, return empty array [].`;

  const result = await model.generateContent(prompt);
  const rawText = result.response.text().trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      return parsed.filter(item => item && typeof item.event_name === 'string' && item.event_name.trim().length > 0);
    }
  } catch (parseErr) {
    console.error('Failed to parse Gemini output as JSON:', rawText, parseErr);
  }

  return [];
}

/**
 * When a user rejects an event with a reason (e.g. "Too expensive"),
 * Gemini produces a suggested extra preference rule.
 */
export async function generatePreferenceRule(
  event: { event_name: string; venue_name?: string | null; date?: string | null },
  rejectionReason: string
): Promise<string> {
  if (!rejectionReason || !rejectionReason.trim()) {
    return `Dislikes events like "${event.event_name}".`;
  }

  try {
    const model = getGeminiModel();

    const prompt = `The user rejected a proposed cultural event with a specific reason. Formulate a concise, clear preference rule to add to the user's preference list.

EVENT DETAILS:
- Name: ${event.event_name}
- Venue: ${event.venue_name || 'N/A'}
- Date: ${event.date || 'N/A'}

REJECTION REASON PROVIDED BY USER:
"${rejectionReason}"

INSTRUCTIONS:
Formulate ONE concise sentence starting with "The user..." describing this new preference rule (e.g., "The user considers events of type [TYPE] at [VENUE/PRICE] too expensive" or "The user dislikes [GENRE] events on weeknights").
Return ONLY the raw preference rule string without quotes or markdown formatting.`;

    const result = await model.generateContent(prompt);
    const rule = result.response.text().trim();
    if (rule.length > 0) {
      return rule;
    }
  } catch (err) {
    console.error('Error generating preference rule with Gemini:', err);
  }

  return `The user prefers to avoid events like "${event.event_name}" because: ${rejectionReason}`;
}

/* ==========================================================================
   Supabase Database Helpers for /discover
   ========================================================================== */

// --- Sources (URLs) ---
export async function getDiscoverUrls(): Promise<DiscoverUrl[]> {
  const { data, error } = await supabase
    .from('discover_urls')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching discover_urls:', error);
    return [];
  }
  return data || [];
}

export async function addDiscoverUrl(url: string, name?: string): Promise<DiscoverUrl> {
  const { data, error } = await supabase
    .from('discover_urls')
    .insert([{ url: url.trim(), name: name ? name.trim() : null }])
    .select()
    .single();

  if (error) {
    console.error('Error inserting discover_url:', error);
    throw new Error(error.message || 'Failed to add source URL');
  }
  return data;
}

export async function deleteDiscoverUrl(id: string): Promise<void> {
  const { error } = await supabase
    .from('discover_urls')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting discover_url:', error);
    throw new Error(error.message || 'Failed to delete source URL');
  }
}

export async function updateDiscoverUrlLastExtracted(
  id: string,
  rawEvents: Array<Record<string, unknown>>
): Promise<DiscoverUrl> {
  const { data, error } = await supabase
    .from('discover_urls')
    .update({
      last_extracted_json: rawEvents,
      last_scraped_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating last_extracted_json:', error);
    throw new Error(error.message || 'Failed to save last extracted JSON');
  }

  return data;
}

export async function clearDiscoverUrlLastExtracted(id: string): Promise<DiscoverUrl> {
  const { data: urlRow } = await supabase
    .from('discover_urls')
    .select('url')
    .eq('id', id)
    .single();

  if (urlRow?.url) {
    await clearDiscoverCrawledSublinks(urlRow.url);
  }

  const { data, error } = await supabase
    .from('discover_urls')
    .update({
      last_extracted_json: [],
      last_scraped_at: null
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error clearing last_extracted_json:', error);
    throw new Error(error.message || 'Failed to clear last extracted JSON');
  }

  return data;
}

// --- Crawled Sublinks (Deduplication) ---
export async function getDiscoverCrawledSublinks(sourceUrl: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('discover_crawled_sublinks')
    .select('sublink_url')
    .eq('source_url', sourceUrl);

  if (error) {
    console.error('Error fetching discover_crawled_sublinks:', error);
    return new Set();
  }
  return new Set((data || []).map((row) => row.sublink_url));
}

export async function saveDiscoverCrawledSublinks(sourceUrl: string, sublinkUrls: string[]): Promise<void> {
  if (!sublinkUrls || sublinkUrls.length === 0) return;

  const rows = sublinkUrls.map((url) => ({
    source_url: sourceUrl,
    sublink_url: url
  }));

  const { error } = await supabase
    .from('discover_crawled_sublinks')
    .upsert(rows, { onConflict: 'source_url,sublink_url' });

  if (error) {
    console.error('Error saving discover_crawled_sublinks:', error);
  }
}

export async function clearDiscoverCrawledSublinks(sourceUrl: string): Promise<void> {
  const { error } = await supabase
    .from('discover_crawled_sublinks')
    .delete()
    .eq('source_url', sourceUrl);

  if (error) {
    console.error('Error clearing discover_crawled_sublinks:', error);
  }
}

// --- Preferences ---
export async function getDiscoverPreferences(): Promise<DiscoverPreferences> {
  const { data, error } = await supabase
    .from('discover_preferences')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error fetching discover_preferences:', error);
  }

  if (data) {
    return data;
  }

  // Create default preference row if none exists
  const defaultText = `My Cultural & Music Event Preferences:
- Musical tastes: Rock, Indie, Electronic, Jazz, Acoustic, Classical.
- Event types: Live concerts, intimate gig sessions, art exhibitions, tech & philosophy meetups, theater plays.
- Preferred venues: Small to mid-sized venues with good acoustics.`;

  const { data: created, error: createErr } = await supabase
    .from('discover_preferences')
    .insert([{ content: defaultText }])
    .select()
    .single();

  if (createErr) {
    console.error('Error creating default discover_preferences:', createErr);
    return { id: 'temp-id', content: defaultText, updated_at: new Date().toISOString() };
  }

  return created;
}

export async function updateDiscoverPreferences(content: string): Promise<DiscoverPreferences> {
  const current = await getDiscoverPreferences();

  const { data, error } = await supabase
    .from('discover_preferences')
    .update({ content, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating discover_preferences:', error);
    throw new Error(error.message || 'Failed to update preferences');
  }

  return data;
}

export async function appendDiscoverPreferenceRule(newRule: string): Promise<DiscoverPreferences> {
  const current = await getDiscoverPreferences();
  const updatedContent = `${current.content.trim()}\n- ${newRule.trim()}`;
  return updateDiscoverPreferences(updatedContent);
}

// --- Discover Events ---
export async function getDiscoverEvents(status?: DiscoverEventStatus): Promise<DiscoverEvent[]> {
  let query = supabase.from('discover_events').select('*');
  if (status) {
    query = query.eq('status', status);
  }
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching discover_events:', error);
    return [];
  }
  return data || [];
}

export async function createDiscoverEvent(
  eventData: Omit<DiscoverEvent, 'id' | 'created_at'>
): Promise<DiscoverEvent> {
  const { data, error } = await supabase
    .from('discover_events')
    .insert([{
      event_name: eventData.event_name,
      venue_name: eventData.venue_name || null,
      date: eventData.date || null,
      url: eventData.url || null,
      status: eventData.status || 'candidate',
      rejection_reason: eventData.rejection_reason || null,
      source_url: eventData.source_url || null
    }])
    .select()
    .single();

  if (error) {
    console.error('Error inserting discover_event:', error);
    throw new Error(error.message || 'Failed to create discover event');
  }

  return data;
}

export async function updateDiscoverEventStatus(
  id: string,
  status: DiscoverEventStatus,
  rejectionReason?: string
): Promise<DiscoverEvent> {
  const updatePayload: Record<string, unknown> = { status };
  if (rejectionReason !== undefined) {
    updatePayload.rejection_reason = rejectionReason;
  }

  const { data, error } = await supabase
    .from('discover_events')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating discover_event status:', error);
    throw new Error(error.message || 'Failed to update discover event status');
  }

  return data;
}

/**
 * On-demand scraping execution:
 * 1. Fetch saved source URLs & user preferences.
 * 2. Fetch current interested/upcoming events to discard duplicates.
 * 3. Scrape, prune HTML, and extract new candidate events via Gemini.
 * 4. Save candidates into discover_events table.
 */
export async function runOnDemandDiscovery(sourceUrlId?: string): Promise<{ added: number; errors: string[] }> {
  let urls = await getDiscoverUrls();
  if (sourceUrlId) {
    urls = urls.filter(u => u.id === sourceUrlId);
  }
  const preferences = await getDiscoverPreferences();
  const existingEvents = await getDiscoverEvents();

  // Create a normalized set of existing event names/urls to prevent duplicates
  const existingSet = new Set(
    existingEvents.map(e => `${e.event_name.toLowerCase().trim()}|${(e.date || '').slice(0, 10)}`)
  );

  let totalAdded = 0;
  const errors: string[] = [];

  if (urls.length === 0) {
    return { added: 0, errors: ['No matching source URL found.'] };
  }

  for (const src of urls) {
    try {
      const res = await fetch(src.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(15000),
        cache: 'no-store'
      });

      if (!res.ok) {
        errors.push(`Failed to fetch ${src.url} (Status: ${res.status})`);
        continue;
      }

      const rawHtml = await res.text();
      const pruned = pruneHtml(rawHtml);

      const extracted = await extractEventsWithGemini(pruned, preferences.content, src.url);

      for (const item of extracted) {
        const key = `${item.event_name.toLowerCase().trim()}|${(item.date || '').slice(0, 10)}`;
        if (!existingSet.has(key)) {
          existingSet.add(key);
          await createDiscoverEvent({
            event_name: item.event_name,
            venue_name: item.venue_name || null,
            date: item.date || null,
            url: item.url || src.url,
            status: 'candidate',
            source_url: src.url
          });
          totalAdded++;
        }
      }
    } catch (err) {
      console.error(`Error processing URL ${src.url}:`, err);
      errors.push(`Error scraping ${src.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { added: totalAdded, errors };
}
