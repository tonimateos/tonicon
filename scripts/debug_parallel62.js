#!/usr/bin/env node

/**
 * Diagnostic CLI Script for Paral·lel 62 (https://paral-lel62.cat/agenda/)
 * Crawls using WordPress REST API (/wp-json/wp/v2/event)
 * 
 * Usage:
 *   node scripts/debug_parallel62.js [target_url] [output_file]
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const DEFAULT_URL = 'https://paral-lel62.cat/agenda/';
const DEFAULT_OUTPUT_FILE = 'crawled_output.json';

const targetUrl = process.argv[2] || DEFAULT_URL;
const outputFile = process.argv[3] || DEFAULT_OUTPUT_FILE;

console.log('\n===============================================================');
console.log(' 🚀 Paral·lel 62 WP-JSON REST API Crawler');
console.log('===============================================================');
console.log(`📍 Base Agenda URL: ${targetUrl}`);
console.log(`💾 Output Destination: ${outputFile}\n`);

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7,ca;q=0.6',
      'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}

async function fetchPageHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7,ca;q=0.6',
      'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

async function run() {
  console.log('📡 Fetching events via WordPress REST API: https://paral-lel62.cat/wp-json/wp/v2/event?per_page=100');
  
  let eventsData = [];
  try {
    eventsData = await fetchJson('https://paral-lel62.cat/wp-json/wp/v2/event?per_page=100');
  } catch (err) {
    console.warn(`   ⚠️ Error fetching 100 items, trying 50: ${err.message}`);
    eventsData = await fetchJson('https://paral-lel62.cat/wp-json/wp/v2/event?per_page=50');
  }

  console.log(`\n🎉 Total events returned by WP-JSON API: ${eventsData.length}`);

  const discoveredSublinks = [];
  eventsData.forEach((item, idx) => {
    const link = item.link || item.guid?.rendered;
    const title = cheerio.load(item.title?.rendered || '').text().trim();
    if (link) {
      discoveredSublinks.push({ link, title });
      console.log(`   ${idx + 1}. [${title}] -> ${link}`);
    }
  });

  // Deep Crawl Subpages
  const crawlLimit = Math.min(discoveredSublinks.length, 10);
  console.log(`\n---------------------------------------------------------------`);
  console.log(` 🕵️  Deep Crawling ${crawlLimit} Sublinks to Extract Detailed Metadata`);
  console.log(`---------------------------------------------------------------\n`);

  const crawledSubpages = [];

  for (let i = 0; i < crawlLimit; i++) {
    const { link, title } = discoveredSublinks[i];
    console.log(`[${i + 1}/${crawlLimit}] Crawling sublink: ${link}`);

    try {
      const subHtml = await fetchPageHtml(link);
      const $sub = cheerio.load(subHtml);

      // Remove noise tags
      $sub('script, style, noscript, nav, footer, header, iframe, svg, form, button').remove();

      // Extract headings
      const headings = [];
      $sub('h1, h2, h3').each((_, el) => {
        const text = $sub(el).text().trim();
        if (text) headings.push(text);
      });

      // Extract description paragraphs
      const descriptionParagraphs = [];
      $sub('.entry-content p, .event-description p, article p, main p, p').each((_, el) => {
        const text = $sub(el).text().trim();
        if (text && text.length > 15 && !text.includes('cookies') && !text.includes('cookie')) {
          descriptionParagraphs.push(text);
        }
      });

      const fullDescription =
        descriptionParagraphs.length > 0
          ? descriptionParagraphs.join('\n\n')
          : $sub('body').text().replace(/\s+/g, ' ').trim();

      const fullBodyText = $sub('body').text().replace(/\s+/g, ' ').trim();

      crawledSubpages.push({
        event_sublink_url: link,
        page_title: $sub('title').text().trim() || title,
        headings: headings.slice(0, 5),
        full_event_description: fullDescription,
        full_page_text: fullBodyText
      });

    } catch (err) {
      console.warn(`   ⚠️  Failed to fetch sublink ${link}: ${err.message}`);
    }
  }

  // Save raw output JSON
  const crawlerPayload = {
    source_agenda_url: targetUrl,
    total_sublinks_found: discoveredSublinks.length,
    all_discovered_sublinks: discoveredSublinks.map(d => d.link),
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
