#!/usr/bin/env node

/**
 * CLI Crawler implementing Alternative D (Headless Browser / Sublink Crawler).
 * 
 * Usage:
 *   node scripts/crawl_alternative_d.js [target_url]
 * 
 * Example:
 *   node scripts/crawl_alternative_d.js https://lanaubarcelona.es/en/agenda
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Load .env.local variables if available
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length > 0) {
      let val = rest.join('=').trim().replace(/^["']|["']$/g, '');
      process.env[key.trim()] = val;
    }
  }
}

const DEFAULT_URL = 'https://lanaubarcelona.es/en/agenda';
const DEFAULT_OUTPUT_FILE = 'crawled_output.json';

const targetUrl = process.argv[2] || DEFAULT_URL;
const outputFile = process.argv[3] || DEFAULT_OUTPUT_FILE;

console.log('\n===============================================================');
console.log(' 🕷️  Alternative D: Sublink & Headless DOM Crawler CLI');
console.log('===============================================================');
console.log(`📍 Target Main Agenda URL: ${targetUrl}`);
console.log(`💾 Output Destination: ${outputFile}\n`);

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

async function run() {
  console.log('🌐 Fetching main agenda page HTML...');
  const mainHtml = await fetchPage(targetUrl);
  const $main = cheerio.load(mainHtml);

  const mainTitle = $main('title').text().trim();
  console.log(`📄 Page Title: "${mainTitle}"`);

  // Extract all event sublinks from the DOM structure
  console.log('\n🔍 Discovering event sublinks from HTML DOM structure...');
  const discoveredLinks = new Set();

  $main('a[href]').each((_, el) => {
    const href = $main(el).attr('href');
    if (!href) return;

    try {
      const absUrl = new URL(href, targetUrl).href;
      // Filter out non-event links (nav, pagination, footer, images, etc.)
      const isEventLink =
        absUrl !== targetUrl &&
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
          absUrl.includes('lanaubarcelona.es/en/agenda/'));

      if (isEventLink) {
        discoveredLinks.add(absUrl);
      }
    } catch {}
  });

  const sublinks = Array.from(discoveredLinks);
  console.log(`✅ Discovered ${sublinks.length} distinct event sublink(s):\n`);
  sublinks.forEach((link, idx) => console.log(`   ${idx + 1}. ${link}`));

  // Deep Crawl Sublinks
  const crawlLimit = Math.min(sublinks.length, 6);
  console.log(`\n---------------------------------------------------------------`);
  console.log(` 🕵️  Deep Crawling ${crawlLimit} Sublinks to Extract Detailed Metadata`);
  console.log(`---------------------------------------------------------------\n`);

  const crawledSubpages = [];

  for (let i = 0; i < crawlLimit; i++) {
    const sublink = sublinks[i];
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
    agenda_page_title: mainTitle,
    total_sublinks_found: sublinks.length,
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

run().catch((err) => {
  console.error('❌ Fatal script error:', err);
  process.exit(1);
});
