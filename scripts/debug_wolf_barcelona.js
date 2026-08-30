#!/usr/bin/env node

/**
 * Diagnostic Debug Script for Wolf Barcelona (https://wolfbarcelona.com/conciertos/)
 * 
 * Usage:
 *   node scripts/debug_wolf_barcelona.js [target_url]
 */

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const TARGET_URL = process.argv[2] || 'https://wolfbarcelona.com/conciertos/';
const OUTPUT_FILE = process.argv[3] || 'crawled_output.json';

console.log('\n===============================================================');
console.log(' 🐺 Wolf Barcelona Event Extraction Diagnostic Script');
console.log('===============================================================');
console.log(`📍 Target URL: ${TARGET_URL}\n`);

async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7,ca;q=0.6'
    },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.json();
}

async function runDiagnostics() {
  const diagnostics = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    html_length: 0,
    title: '',
    meta_generator: '',
    wp_api_detected: false,
    wp_endpoints: {},
    iframes_found: [],
    widgets_detected: [],
    extracted_sublinks: [],
    extracted_raw_text: '',
    puppeteer_used: false,
    extracted_events: []
  };

  // Step 1: Fetch Base HTML via standard HTTP GET
  console.log('1️⃣ Fetching base HTML content via HTTP GET...');
  let rawHtml = '';
  try {
    rawHtml = await fetchUrl(TARGET_URL);
    diagnostics.html_length = rawHtml.length;
    console.log(`   ✅ Success! HTML length: ${rawHtml.length} chars.`);
  } catch (err) {
    console.error(`   ❌ Failed to fetch base HTML: ${err.message}`);
    return;
  }

  const $ = cheerio.load(rawHtml);
  diagnostics.title = $('title').text().trim();
  diagnostics.meta_generator = $('meta[name="generator"]').attr('content') || '';
  console.log(`   ℹ️ Page Title: "${diagnostics.title}"`);
  if (diagnostics.meta_generator) {
    console.log(`   ℹ️ Generator: ${diagnostics.meta_generator}`);
  }

  // Step 2: Check for Widget / iFrame / External Ticketing Embeds
  console.log('\n2️⃣ Inspecting IFrames and Third-Party Embed Widgets...');
  $('iframe').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      diagnostics.iframes_found.push(src);
      console.log(`   🖼️  Found iframe src: ${src}`);
    }
  });

  const pageText = $('body').text().replace(/\s+/g, ' ');
  if (pageText.includes('fourvenues') || rawHtml.includes('fourvenues')) diagnostics.widgets_detected.push('fourvenues');
  if (pageText.includes('xceed') || rawHtml.includes('xceed')) diagnostics.widgets_detected.push('xceed');
  if (pageText.includes('ticketmaster') || rawHtml.includes('ticketmaster')) diagnostics.widgets_detected.push('ticketmaster');
  if (pageText.includes('eventbrite') || rawHtml.includes('eventbrite')) diagnostics.widgets_detected.push('eventbrite');
  if (pageText.includes('dice.fm') || rawHtml.includes('dice.fm')) diagnostics.widgets_detected.push('dice.fm');

  if (diagnostics.widgets_detected.length > 0) {
    console.log(`   ⚠️ Detected ticketing widgets: ${diagnostics.widgets_detected.join(', ')}`);
  } else {
    console.log(`   ℹ️ No third-party ticketing widgets detected in raw HTML.`);
  }

  // Step 3: Check WP-JSON REST API Endpoints
  console.log('\n3️⃣ Probing WordPress REST API endpoints...');
  const origin = new URL(TARGET_URL).origin;
  const wpTestTypes = ['events', 'event', 'conciertos', 'concierto', 'agenda', 'posts'];

  for (const typeKey of wpTestTypes) {
    const ep = `${origin}/wp-json/wp/v2/${typeKey}?per_page=50`;
    try {
      const data = await fetchJson(ep);
      if (Array.isArray(data) && data.length > 0) {
        diagnostics.wp_api_detected = true;
        diagnostics.wp_endpoints[typeKey] = data.length;
        console.log(`   ✅ WP-JSON Endpoint found! /wp-json/wp/v2/${typeKey} returned ${data.length} items.`);
        
        data.slice(0, 10).forEach((item, idx) => {
          const link = item.link || item.guid?.rendered;
          const titleText = cheerio.load(item.title?.rendered || '').text().trim();
          if (link) {
            diagnostics.extracted_sublinks.push({ link, title: titleText, source: `wp-json/${typeKey}` });
            console.log(`      ${idx + 1}. [${titleText}] -> ${link}`);
          }
        });
        break;
      }
    } catch {}
  }

  if (!diagnostics.wp_api_detected) {
    console.log(`   ℹ️ WP-JSON endpoints did not return custom event post types.`);
  }

  // Step 4: DOM Sublink Discovery
  console.log('\n4️⃣ Inspecting HTML DOM Anchor Tags (<a> links)...');
  const domLinks = new Set();
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href) return;

    try {
      const resolved = new URL(href, TARGET_URL).toString().split('#')[0];
      const lower = resolved.toLowerCase();

      if (
        lower.includes('concierto') ||
        lower.includes('evento') ||
        lower.includes('event') ||
        lower.includes('comprar') ||
        lower.includes('entradas') ||
        lower.includes('tickets') ||
        lower.includes('/agenda/') ||
        lower.includes('/programacion/') ||
        (lower.startsWith(origin) && !lower.endsWith('/conciertos/') && !lower.endsWith('/conciertos') && lower.split('/').filter(Boolean).length >= 4)
      ) {
        if (!domLinks.has(resolved)) {
          domLinks.add(resolved);
          diagnostics.extracted_sublinks.push({ link: resolved, title: text, source: 'dom_link' });
        }
      }
    } catch {}
  });

  console.log(`   🔗 Total potential event sublinks found in DOM: ${domLinks.size}`);
  Array.from(domLinks).slice(0, 15).forEach((link, idx) => {
    console.log(`      ${idx + 1}. ${link}`);
  });

  // Step 5: Puppeteer Browser Render
  if (diagnostics.extracted_sublinks.length === 0 || diagnostics.iframes_found.length > 0) {
    console.log('\n5️⃣ Content looks dynamic / embedded. Running Puppeteer Headless Browser...');
    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
      );

      console.log(`   🌐 Navigating Puppeteer to ${TARGET_URL}...`);
      await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });

      await new Promise((r) => setTimeout(r, 3000));

      const renderedHtml = await page.content();
      diagnostics.puppeteer_used = true;
      console.log(`   ✅ Puppeteer rendered HTML length: ${renderedHtml.length} chars.`);

      const $p = cheerio.load(renderedHtml);
      $p('a[href]').each((_, el) => {
        const href = $p(el).attr('href');
        const text = $p(el).text().trim();
        if (!href) return;
        try {
          const resolved = new URL(href, TARGET_URL).toString().split('#')[0];
          if (!domLinks.has(resolved)) {
            domLinks.add(resolved);
            diagnostics.extracted_sublinks.push({ link: resolved, title: text, source: 'puppeteer_dom' });
          }
        } catch {}
      });

      console.log(`   🔗 Total sublinks after Puppeteer render: ${domLinks.size}`);
      await browser.close();
    } catch (pupErr) {
      console.warn(`   ⚠️ Puppeteer execution failed: ${pupErr.message}`);
    }
  }

  // Step 6: Test Gemini Raw Event Extraction via lib/discover.ts
  console.log('\n6️⃣ Executing extractAllRawEventsAlternativeD via lib/discover.ts...');
  try {
    const { extractAllRawEventsAlternativeD } = require('../lib/discover');
    console.log('   🧠 Sending page content to Gemini model for event extraction...');

    const rawEvents = await extractAllRawEventsAlternativeD(
      TARGET_URL,
      undefined,
      (progress) => {
        console.log(`   [Progress] ${progress.type}: ${progress.message || progress.url || ''}`);
      }
    );

    diagnostics.extracted_events = rawEvents;
    console.log(`\n🎉 Extracted ${rawEvents.length} raw events:`);
    console.log(JSON.stringify(rawEvents, null, 2));

  } catch (geminiErr) {
    console.error(`   ❌ Gemini raw event extraction error: ${geminiErr.message}`);
  }

  // Save diagnostic report to file
  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(diagnostics, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(` 💾 DIAGNOSTIC RESULTS SAVED TO:`);
  console.log(`    ${outputPath}`);
  console.log('===============================================================\n');
}

runDiagnostics().catch((err) => {
  console.error('❌ Fatal Diagnostic Error:', err);
});
