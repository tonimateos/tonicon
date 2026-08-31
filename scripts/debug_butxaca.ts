import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

if (fs.existsSync('.env.local')) {
  const envConfig = fs.readFileSync('.env.local', 'utf8');
  for (const line of envConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      process.env[key] = val;
    }
  }
}

const TARGET_URL = process.argv[2] || 'https://www.butxaca.com/';
const OUTPUT_FILE = process.argv[3] || 'crawled_output.json';

console.log('\n===============================================================');
console.log(' 🎟️  Butxaca.com Event Crawler Diagnostic Script');
console.log('===============================================================');
console.log(`📍 Target URL: ${TARGET_URL}`);
console.log(`💾 Output Destination: ${OUTPUT_FILE}\n`);

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'ca-ES,ca;q=0.9,es-ES;q=0.8,es;q=0.7,en-US;q=0.6'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  return await res.text();
}

async function run() {
  console.log('1️⃣ Fetching main page HTML...');
  const mainHtml = await fetchPage(TARGET_URL);
  const $main = cheerio.load(mainHtml);

  const mainTitle = $main('title').text().trim();
  console.log(`   📄 Page Title: "${mainTitle}"`);

  // Step 2: Direct DOM Extraction for Event Cards (e.g. bottom agenda / event listings)
  console.log('\n2️⃣ Extracting event listing cards directly from DOM structure...');
  const directEventsFromDom: Array<Record<string, unknown>> = [];

  // Inspect event items across containers (tables, list items, views-row, article elements)
  $main('.event, article, .views-row, tr, .item, .card, .agenda-item').each((_, el) => {
    const titleText = $main(el).find('h1, h2, h3, h4, .title, a').first().text().replace(/\s+/g, ' ').trim();
    const link = $main(el).find('a[href]').attr('href');
    const dateText = $main(el).find('.date, .fecha, time, .data, .time').text().replace(/\s+/g, ' ').trim();
    const venueText = $main(el).find('.venue, .space, .espai, .lloc, .location').text().replace(/\s+/g, ' ').trim();

    if (titleText && titleText.length > 3 && link) {
      try {
        const absLink = new URL(link, TARGET_URL).href.split('#')[0];
        if (!absLink.includes('mailto') && !absLink.includes('register') && !absLink.includes('identificat')) {
          directEventsFromDom.push({
            event_name: titleText,
            event_sublink_url: absLink,
            date: dateText || undefined,
            venue: venueText || undefined,
            extracted_from: 'dom_card'
          });
        }
      } catch {}
    }
  });

  console.log(`   ✅ Directly extracted ${directEventsFromDom.length} event items from DOM containers.`);

  // Step 3: Discover Precise Event Detail Sublinks
  console.log('\n3️⃣ Filtering precise event detail sublinks (details/ & item/)...');
  const sublinksSet = new Set<string>();

  $main('a[href]').each((_, el) => {
    const href = $main(el).attr('href');
    if (!href) return;

    try {
      const absUrl = new URL(href, TARGET_URL).href.split('#')[0];
      const lower = absUrl.toLowerCase();

      // Target specific event detail pages (details/<name>/<id> or item/<name>/<id>)
      const isSpecificEventDetail =
        (lower.includes('/details/') && lower.split('/details/')[1]?.length > 3) ||
        (lower.includes('/item/') && lower.split('/item/')[1]?.length > 3);

      const isNoise =
        lower.includes('mailto') ||
        lower.includes('register') ||
        lower.includes('identificat') ||
        lower.includes('cookies') ||
        lower.includes('/usuaris/') ||
        lower.includes('/agenda/agenda-del-dia') ||
        lower.includes('/agenda/la-meva-agenda') ||
        lower.includes('/agenda/seleccio-butxaca') ||
        lower.includes('/agenda/barcelona-gratis') ||
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.svg');

      if (isSpecificEventDetail && !isNoise && absUrl !== TARGET_URL) {
        sublinksSet.add(absUrl);
      }
    } catch {}
  });

  const discoveredSublinks = Array.from(sublinksSet);
  console.log(`   🔗 Found ${discoveredSublinks.length} specific event detail sublinks:\n`);
  discoveredSublinks.slice(0, 15).forEach((url, i) => {
    console.log(`      ${i + 1}. ${url}`);
  });

  // Step 4: Deep Crawl Specific Sublinks
  const crawlLimit = Math.min(discoveredSublinks.length, 25);
  console.log(`\n4️⃣ Deep crawling ${crawlLimit} event sublinks...`);
  const crawledSubpages: Array<Record<string, unknown>> = [];

  for (let i = 0; i < crawlLimit; i++) {
    const sublink = discoveredSublinks[i];
    console.log(`   [${i + 1}/${crawlLimit}] Crawling sublink: ${sublink}`);

    try {
      const subHtml = await fetchPage(sublink);
      const $sub = cheerio.load(subHtml);

      // Remove noise tags
      $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

      const pageTitle = $sub('title').text().trim();
      const headings: string[] = [];
      $sub('h1, h2, h3').each((_, h) => {
        const text = $sub(h).text().replace(/\s+/g, ' ').trim();
        if (text) headings.push(text);
      });

      const descriptionParagraphs: string[] = [];
      $sub('p, article, .content, .description, .field-name-body').each((_, p) => {
        const text = $sub(p).text().replace(/\s+/g, ' ').trim();
        if (text && text.length > 15 && !text.includes('cookies') && !text.includes('cookie')) {
          descriptionParagraphs.push(text);
        }
      });

      const fullDesc = descriptionParagraphs.slice(0, 10).join('\n\n') || $sub('body').text().replace(/\s+/g, ' ').trim();

      crawledSubpages.push({
        event_sublink_url: sublink,
        page_title: pageTitle,
        headings: headings.slice(0, 5),
        full_event_description: fullDesc.slice(0, 2000),
        full_page_text: $sub('body').text().replace(/\s+/g, ' ').slice(0, 3000)
      });
    } catch (err) {
      console.warn(`   ⚠️  Failed to fetch ${sublink}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 5: Send structured data to Gemini LLM for final clean JSON extraction
  console.log('\n5️⃣ Sending scraped data to Gemini AI model for structured event extraction...');
  let extractedRawEvents: Array<Record<string, unknown>> = [];

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const apiKey = process.env.GEMINI_API_KEY;

    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { responseMimeType: 'application/json' }
      });

      const prompt = `Extract all cultural events (concerts, music shows, theater, exhibitions) from the following webpage content of ${TARGET_URL}.
For each event, return a JSON object with:
- "event_name": Title / artist / show name
- "date_and_time": Date and time
- "venue": Venue name or city
- "event_sublink_url": Direct detail link or ticket link
- "description": Brief event summary

CRAWLED PAGES CONTENT:
${JSON.stringify(crawledSubpages, null, 2).slice(0, 50000)}

DIRECT DOM EVENT CARDS:
${JSON.stringify(directEventsFromDom, null, 2)}

Return a JSON array of event objects:`;

      const result = await model.generateContent(prompt);
      const respText = result.response.text();
      const parsed = JSON.parse(respText);
      if (Array.isArray(parsed)) {
        extractedRawEvents = parsed;
      }
    }
  } catch (geminiErr) {
    console.warn(`   ⚠️  Gemini API notice: ${geminiErr instanceof Error ? geminiErr.message : String(geminiErr)}`);
  }

  // Fallback: If Gemini raw events are empty, combine direct DOM events and subpages
  if (extractedRawEvents.length === 0) {
    extractedRawEvents = directEventsFromDom.length > 0
      ? directEventsFromDom
      : crawledSubpages.map((sp) => ({
          event_name: sp.page_title,
          event_sublink_url: sp.event_sublink_url,
          description: sp.full_event_description
        }));
  }

  // Construct Final Output Payload
  const crawlerPayload = {
    source_agenda_url: TARGET_URL,
    agenda_page_title: mainTitle,
    total_sublinks_found: discoveredSublinks.length,
    all_discovered_sublinks: discoveredSublinks,
    direct_dom_events_found: directEventsFromDom.length,
    extracted_events: extractedRawEvents,
    deep_crawled_subpages: crawledSubpages
  };

  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(crawlerPayload, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(` 💾 CRAWLER OUTPUT SAVED TO FILE:`);
  console.log(`    ${outputPath}`);
  console.log(` 🎉 Total Extracted Events: ${extractedRawEvents.length}`);
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('❌ Fatal script error:', err);
  process.exit(1);
});
