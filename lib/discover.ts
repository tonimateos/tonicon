import { GoogleGenerativeAI } from '@google/generative-ai';
import * as cheerio from 'cheerio';
import { supabase } from './supabase';
import { DiscoverEvent, DiscoverEventStatus, DiscoverPreferences, DiscoverUrl } from './types';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

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
 * Uses Gemini to parse pruned HTML content against user preferences
 * and extract matching candidate events.
 */
export async function extractEventsWithGemini(
  prunedHtml: string,
  userPreferences: string,
  sourceUrl: string
): Promise<Array<{ event_name: string; venue_name?: string; date?: string; url?: string }>> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('GEMINI_API_KEY is not set. Returning empty event candidates.');
    return [];
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    let model;
    try {
      model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    } catch {
      model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }

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
  } catch (err) {
    console.error('Error calling Gemini for event extraction:', err);
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
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !rejectionReason || !rejectionReason.trim()) {
    return `Dislikes events like "${event.event_name}" (${rejectionReason || 'No reason specified'}).`;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    let model;
    try {
      model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    } catch {
      model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }

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
export async function runOnDemandDiscovery(): Promise<{ added: number; errors: string[] }> {
  const urls = await getDiscoverUrls();
  const preferences = await getDiscoverPreferences();
  const existingEvents = await getDiscoverEvents();

  // Create a normalized set of existing event names/urls to prevent duplicates
  const existingSet = new Set(
    existingEvents.map(e => `${e.event_name.toLowerCase().trim()}|${(e.date || '').slice(0, 10)}`)
  );

  let totalAdded = 0;
  const errors: string[] = [];

  if (urls.length === 0) {
    return { added: 0, errors: ['No source URLs configured. Please add event sources in the Sources tab.'] };
  }

  for (const src of urls) {
    try {
      const res = await fetch(src.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
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
