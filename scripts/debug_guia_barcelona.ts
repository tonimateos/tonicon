import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

// Load environment variables from .env.local
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

const TARGET_URL = process.argv[2] || 'https://guia.barcelona.cat/';
const OUTPUT_FILE = process.argv[3] || 'crawled_output.json';

console.log('\n===============================================================');
console.log(' Guia Barcelona (https://guia.barcelona.cat/) Diagnostic Script');
console.log('===============================================================');
console.log(' Target URL: ' + TARGET_URL);
console.log(' Output Destination: ' + OUTPUT_FILE + '\n');

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function run() {
  // Step 1: Fetch Main Page and follow "Veure més activitats"
  console.log('1️⃣ Fetching main home page and following "Veure més activitats" (agenda-recomenada)...');
  const mainHtml = await fetchHtml(TARGET_URL);
  const $main = cheerio.load(mainHtml);
  const mainTitle = $main('title').text().trim();
  console.log(`   📄 Page Title: "${mainTitle}"`);

  // Discover "Veure més activitats" section links
  const agendaPagesSet = new Set<string>();
  agendaPagesSet.add(TARGET_URL);
  agendaPagesSet.add('https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona');

  $main('a[href]').each((_, el) => {
    const href = $main(el).attr('href');
    const text = $main(el).text().replace(/\s+/g, ' ').trim().toLowerCase();
    if (href && (text.includes('veure') || text.includes('vegeu') || text.includes('activitat') || href.includes('/agenda'))) {
      try {
        const abs = new URL(href, TARGET_URL).href.split('#')[0];
        agendaPagesSet.add(abs);
      } catch {}
    }
  });

  // Step 2: Expand all Category Tabs under "Veure més activitats"
  console.log('\n2️⃣ Expanding all activity category section pages...');
  const mevaHtml = await fetchHtml('https://guia.barcelona.cat/ca/agenda-recomenada/la-meva-barcelona');
  const $meva = cheerio.load(mevaHtml);

  $meva('a[href]').each((_, el) => {
    const href = $meva(el).attr('href');
    if (href && (href.includes('ctg=') || href.includes('/agenda-recomenada/'))) {
      try {
        const abs = new URL(href, 'https://guia.barcelona.cat/').href.split('#')[0];
        agendaPagesSet.add(abs);
      } catch {}
    }
  });

  const agendaPages = Array.from(agendaPagesSet);
  console.log(`   📂 Discovered ${agendaPages.length} category section pages to crawl:\n`);
  agendaPages.slice(0, 15).forEach((url, i) => console.log(`      ${i + 1}. ${url}`));

  // Step 3: Crawl Section Pages to extract Direct DOM Cards & Detail Sublinks
  console.log('\n3️⃣ Extracting activity cards and detail links (/detall/)...');
  const directDomCards: Array<Record<string, unknown>> = [];
  const detailSublinksSet = new Set<string>();

  for (let i = 0; i < agendaPages.length; i++) {
    const pageUrl = agendaPages[i];
    try {
      const pageHtml = await fetchHtml(pageUrl);
      const $p = cheerio.load(pageHtml);

      // Extract DOM cards
      $p('.item, .content-ag, article, .card, .element').each((_, el) => {
        const titleEl = $p(el).find('h1 a, h2 a, h3 a, h4 a, .title a, .content-ag a').first();
        const titleText = titleEl.text().replace(/\s+/g, ' ').trim() || $p(el).find('h1, h2, h3, h4').first().text().replace(/\s+/g, ' ').trim();
        const rawLink = titleEl.attr('href') || $p(el).find('a[href*="/detall/"]').first().attr('href');
        const dateText = $p(el).find('.data, .date, time, .fecha, .dies').text().replace(/\s+/g, ' ').trim();
        const venueText = $p(el).find('.lloc, .space, .venue, .equipament, .espai').text().replace(/\s+/g, ' ').trim();

        if (titleText && titleText.length > 3 && rawLink) {
          try {
            const absLink = new URL(rawLink, pageUrl).href.split('#')[0];
            const lower = absLink.toLowerCase();

            // Must be a specific detail page, NOT a generic llistat search or mailto link
            const isDetail =
              (lower.includes('/detall/') || lower.includes('que-pots-fer-a-bcn')) &&
              !lower.includes('llistat') &&
              !lower.includes('tipuscerca') &&
              !lower.includes('mailto') &&
              !lower.includes('javascript');

            if (isDetail) {
              directDomCards.push({
                event_name: titleText,
                event_sublink_url: absLink,
                date: dateText || undefined,
                venue: venueText || undefined,
                extracted_from: 'rendered_dom_card'
              });
              detailSublinksSet.add(absLink);
            }
          } catch {}
        }
      });

      // Extract all anchor links matching detail URL criteria
      $p('a[href]').each((_, a) => {
        const href = $p(a).attr('href');
        if (href) {
          try {
            const absDetail = new URL(href, pageUrl).href.split('#')[0];
            const lower = absDetail.toLowerCase();
            const isDetail =
              (lower.includes('/detall/') || lower.includes('que-pots-fer-a-bcn')) &&
              !lower.includes('llistat') &&
              !lower.includes('tipuscerca') &&
              !lower.includes('mailto') &&
              !lower.includes('javascript');

            if (isDetail) {
              detailSublinksSet.add(absDetail);
            }
          } catch {}
        }
      });
    } catch (err) {
      console.warn(`   ⚠️ Could not fetch section page ${pageUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const detailSublinks = Array.from(detailSublinksSet);
  console.log(`   ✅ Direct DOM activity cards extracted: ${directDomCards.length}`);
  console.log(`   🔗 Total unique activity detail sublinks discovered: ${detailSublinks.length}\n`);
  detailSublinks.slice(0, 15).forEach((url, i) => {
    console.log(`      ${i + 1}. ${url}`);
  });

  // Step 4: Deep Crawl Subpages
  const crawlLimit = Math.min(detailSublinks.length, 25);
  console.log(`\n4️⃣ Deep crawling ${crawlLimit} activity detail sublinks...`);
  const crawledSubpages: Array<Record<string, unknown>> = [];

  for (let i = 0; i < crawlLimit; i++) {
    const sublink = detailSublinks[i];
    console.log(`   [${i + 1}/${crawlLimit}] Crawling activity detail: ${sublink}`);

    try {
      const subHtml = await fetchHtml(sublink);
      const $sub = cheerio.load(subHtml);

      // Clean noise tags
      $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

      const pageTitle = $sub('title').text().trim();
      const headings: string[] = [];
      $sub('h1, h2, h3').each((_, h) => {
        const text = $sub(h).text().replace(/\s+/g, ' ').trim();
        if (text) headings.push(text);
      });

      const paragraphs: string[] = [];
      $sub('p, article, .descripcio, .content, .detail, .field-name-body').each((_, p) => {
        const text = $sub(p).text().replace(/\s+/g, ' ').trim();
        if (text && text.length > 15 && !text.includes('cookies')) {
          paragraphs.push(text);
        }
      });

      const fullDesc = paragraphs.slice(0, 10).join('\n\n') || $sub('body').text().replace(/\s+/g, ' ').trim();

      crawledSubpages.push({
        event_sublink_url: sublink,
        page_title: pageTitle,
        headings: headings.slice(0, 5),
        full_event_description: fullDesc.slice(0, 2000),
        full_page_text: $sub('body').text().replace(/\s+/g, ' ').slice(0, 3000)
      });
    } catch (err) {
      console.warn(`   ⚠️ Failed to crawl ${sublink}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Step 5: Send scraped data to Gemini AI for structured extraction with strict URL rules
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

      const prompt = `Extract all cultural events and activities (concerts, music shows, theater, exhibitions, festivals, sports, city tours) from the following webpage content of ${TARGET_URL}.

CRITICAL INSTRUCTIONS FOR "event_sublink_url":
- "event_sublink_url" MUST BE THE EXACT SPECIFIC EVENT DETAIL PAGE URL (e.g. ending in /detall/...html or /que-pots-fer-a-bcn/...).
- NEVER return a category or search listing URL (such as /llistat?tipuscerca=... or /llistat?pg=search...).
- Match each extracted event strictly to its corresponding detail page URL from CRAWLED PAGES CONTENT (field "event_sublink_url") or DIRECT DOM CARDS.

For each event, return a JSON object with:
- "event_name": Title / artist / show / activity name
- "date_and_time": Date and time or date range
- "venue": Venue name, equipament, or neighborhood in Barcelona
- "event_sublink_url": Direct detail page link (MUST be a specific detail URL like /detall/...)
- "description": Brief event summary

CRAWLED PAGES CONTENT:
${JSON.stringify(crawledSubpages, null, 2).slice(0, 50000)}

DIRECT DOM CARDS:
${JSON.stringify(directDomCards, null, 2)}`;

      const modelsToTry = [process.env.GEMINI_MODEL || 'gemini-2.0-flash', 'gemini-2.5-flash'];
      for (const mName of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: mName });
          const result = await model.generateContent(prompt);
          const respText = result.response.text();
          const parsed = JSON.parse(respText);
          if (Array.isArray(parsed)) {
            extractedRawEvents = parsed;
            break;
          }
        } catch (mErr: any) {
          const mErrStr = mErr?.message || String(mErr);
          if (mErrStr.includes('429') || mErrStr.includes('Quota exceeded') || mErrStr.includes('503')) {
            console.warn('   [Warning] Model ' + mName + ' hit rate limit / 429 quota. Retrying with fallback model...');
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          } else {
            throw mErr;
          }
        }
      }
    }
  } catch (geminiErr) {
    console.warn('   [Gemini AI Notice] ' + (geminiErr instanceof Error ? geminiErr.message : String(geminiErr)));
  }

  // Create a map of sublink URL -> full description
  const sublinkToDesc = new Map<string, string>();
  for (const sp of crawledSubpages) {
    const url = (sp.event_sublink_url as string) || '';
    const desc = (sp.full_event_description as string) || '';
    if (url && desc) {
      sublinkToDesc.set(url.trim().toLowerCase(), desc);
    }
  }

  // Ensure every extracted event has its full description attached
  const enrichedEvents = (extractedRawEvents.length > 0 ? extractedRawEvents : directDomCards).map((item) => {
    const link = ((item.event_sublink_url as string) || (item.url as string) || '').trim().toLowerCase();
    const matchedDesc = sublinkToDesc.get(link);
    return {
      event_name: item.event_name,
      date_and_time: item.date_and_time || item.date || undefined,
      venue: item.venue || undefined,
      event_sublink_url: item.event_sublink_url || item.url,
      description: item.description || matchedDesc || undefined,
      extracted_from: item.extracted_from || 'deep_crawled_subpage'
    };
  });

  // Construct Final Output Payload
  const crawlerPayload = {
    source_agenda_url: TARGET_URL,
    agenda_page_title: mainTitle,
    total_category_sections_crawled: agendaPages.length,
    total_sublinks_found: detailSublinks.length,
    all_discovered_sublinks: detailSublinks,
    direct_dom_events_found: directDomCards.length,
    extracted_events: enrichedEvents,
    deep_crawled_subpages: crawledSubpages
  };

  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(crawlerPayload, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(' CRAWLER OUTPUT SAVED TO FILE:');
  console.log('    ' + outputPath);
  console.log(' Total Extracted Activities: ' + extractedRawEvents.length);
  console.log('===============================================================\n');
}

run().catch((err) => {
  console.error('Fatal script error:', err);
  process.exit(1);
});
