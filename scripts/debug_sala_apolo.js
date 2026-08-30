#!/usr/bin/env node

/**
 * Diagnostic CLI Script to debug link extraction and pagination for Sala Apolo (https://www.sala-apolo.com/es/agenda)
 * 
 * Usage:
 *   node scripts/debug_sala_apolo.js [target_url] [max_pages]
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DEFAULT_URL = 'https://www.sala-apolo.com/es/agenda';
const DEFAULT_OUTPUT_FILE = 'crawled_output.json';

const targetUrl = process.argv[2] || DEFAULT_URL;
const maxPages = parseInt(process.argv[3] || '5', 10);
const outputFile = process.argv[4] || DEFAULT_OUTPUT_FILE;

console.log('\n===============================================================');
console.log(' 🔬 Sala Apolo Pagination & Link Extraction Debugger');
console.log('===============================================================');
console.log(`📍 Base Agenda URL: ${targetUrl}`);
console.log(`📑 Crawling up to ${maxPages} pagination pages...`);
console.log(`💾 Output Destination: ${outputFile}\n`);

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

function extractEventLinksFromHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const events = new Set();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absUrl = new URL(href, baseUrl).href;

      // Filter specifically for event detail links (e.g. /evento/, /concierto/, /agenda/detail)
      const isSpecificEventLink =
        absUrl !== baseUrl &&
        !absUrl.endsWith('#') &&
        !absUrl.includes('#openPrice') &&
        !absUrl.includes('/cookies') &&
        !absUrl.includes('/contacto') &&
        !absUrl.includes('/nosotros') &&
        !absUrl.includes('/privacidad') &&
        !absUrl.includes('/legal') &&
        !absUrl.includes('/ciclos') &&
        !absUrl.includes('/clubs') &&
        !absUrl.includes('/noticias') &&
        (absUrl.includes('/evento/') ||
          absUrl.includes('/concierto/') ||
          absUrl.includes('/event/'));

      if (isSpecificEventLink) {
        events.add(absUrl);
      }
    } catch {}
  });

  return Array.from(events);
}

async function run() {
  const allDiscoveredEvents = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const pageUrl = page === 1 ? targetUrl : `${targetUrl.split('?')[0]}?page=${page}`;
    console.log(`🌐 [Page ${page}/${maxPages}] Fetching: ${pageUrl}`);

    try {
      const html = await fetchPage(pageUrl);
      const pageEvents = extractEventLinksFromHtml(html, pageUrl);
      console.log(`   └─ Found ${pageEvents.length} new event link(s) on page ${page}.`);

      if (pageEvents.length === 0 && page > 1) {
        console.log(`   ℹ️ No more events found. Reached end of pagination at page ${page - 1}.`);
        break;
      }

      pageEvents.forEach(e => allDiscoveredEvents.add(e));
    } catch (err) {
      console.warn(`   ⚠️ Failed to fetch page ${page}: ${err.message}`);
      break;
    }
  }

  const finalEventsList = Array.from(allDiscoveredEvents);
  console.log('\n===============================================================');
  console.log(`🎉 Discovered total ${finalEventsList.length} distinct event detail URLs.`);
  console.log('===============================================================\n');

  // Deep Crawl Sublinks
  const crawlLimit = Math.min(finalEventsList.length, 10);
  console.log(`---------------------------------------------------------------`);
  console.log(` 🕵️  Deep Crawling ${crawlLimit} Sublinks to Extract Detailed Metadata`);
  console.log(`---------------------------------------------------------------\n`);

  const crawledSubpages = [];

  for (let i = 0; i < crawlLimit; i++) {
    const sublink = finalEventsList[i];
    console.log(`[${i + 1}/${crawlLimit}] Crawling sublink: ${sublink}`);

    try {
      const subHtml = await fetchPage(sublink);
      const $sub = cheerio.load(subHtml);

      // Remove noise tags and cookie warnings
      $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

      // Extract headings
      const headings = [];
      $sub('h1, h2, h3').each((_, el) => {
        const text = $sub(el).text().trim();
        if (text) headings.push(text);
      });

      // Targeted extraction for full concert description paragraphs
      const descriptionParagraphs = [];
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

      crawledSubpages.push({
        event_sublink_url: sublink,
        page_title: $sub('title').text().trim(),
        headings: headings.slice(0, 5),
        full_event_description: fullDescription,
        full_page_text: fullBodyText
      });

    } catch (err) {
      console.warn(`   ⚠️  Failed to fetch sublink ${sublink}: ${err.message}`);
    }
  }

  // Construct raw crawler payload
  const crawlerPayload = {
    source_agenda_url: targetUrl,
    total_sublinks_found: finalEventsList.length,
    all_discovered_sublinks: finalEventsList,
    deep_crawled_subpages: crawledSubpages
  };

  const outputPath = path.resolve(process.cwd(), outputFile);
  fs.writeFileSync(outputPath, JSON.stringify(crawlerPayload, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(` 💾 CRAWLER OUTPUT SAVED TO FILE:`);
  console.log(`    ${outputPath}`);
  console.log('===============================================================\n');

  console.log('🏁 Crawl finished cleanly.\n');
}

run().catch(err => {
  console.error('❌ Fatal error:', err);
});
