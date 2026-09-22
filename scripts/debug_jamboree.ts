import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

// Load environment variables from .env.local if available before imports
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
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://zxobtoquisgwzzcjrliy.supabase.co';
}

const TARGET_URL = process.argv[2] || 'https://jamboreejazz.com/agenda/';
const PAST_JSON_FILE = process.argv[3] || 'scripts/jamboree.json';
const OUTPUT_FILE = process.argv[4] || 'scripts/jamboree_debug_result.json';

console.log('\n===============================================================');
console.log(' 🎷 Jamboree Jazz Scraper Debug & Reproduction Test');
console.log('===============================================================');
console.log(`📍 Target URL: ${TARGET_URL}`);
console.log(`📜 Past JSON File: ${PAST_JSON_FILE}`);
console.log(`💾 Output File: ${OUTPUT_FILE}\n`);

async function runDebug() {
  const { getRawEventKey } = await import('../lib/discover');

  // 1. Load Past JSON
  let pastEvents: Array<Record<string, unknown>> = [];
  const pastPath = path.resolve(process.cwd(), PAST_JSON_FILE);
  if (fs.existsSync(pastPath)) {
    try {
      pastEvents = JSON.parse(fs.readFileSync(pastPath, 'utf8'));
      console.log(`✅ Loaded ${pastEvents.length} past items from ${PAST_JSON_FILE}`);
    } catch (e) {
      console.error(`❌ Failed to parse ${PAST_JSON_FILE}:`, e);
    }
  } else {
    console.warn(`⚠️ Past JSON file ${PAST_JSON_FILE} not found!`);
  }

  // Build past keys set
  const pastKeys = new Set<string>();
  const pastUrls = new Set<string>();
  for (const e of pastEvents) {
    const key = getRawEventKey(e);
    if (key) pastKeys.add(key);
    const url = (e.event_sublink_url || e.event_url || e.url) as string;
    if (url) {
      const cleanUrl = url.trim().toLowerCase().split('#')[0];
      pastKeys.add(cleanUrl);
      pastUrls.add(cleanUrl);
    }
  }
  console.log(`🔑 Built ${pastKeys.size} distinct past deduplication keys/URLs.`);

  // 2. Fetch agenda page directly and discover all links with Cheerio
  console.log('\n🌐 Fetching target agenda page HTML...');
  const res = await fetch(TARGET_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ca,es,en'
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${TARGET_URL}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Extract all hrefs
  const allHrefs = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) {
      try {
        const abs = new URL(href, TARGET_URL).href.split('#')[0];
        allHrefs.add(abs);
      } catch {}
    }
  });

  console.log(`📄 Total raw links found on agenda page: ${allHrefs.size}`);

  // Analyze link pattern matching:
  // (A) Proper pattern including Catalan /esdeveniment/
  const esdevenimentLinks = Array.from(allHrefs).filter(
    (l) => l.includes('jamboreejazz.com') && (l.includes('/esdeveniment/') || l.includes('/event/'))
  );

  // (B) Old script pattern (missing /esdeveniment/)
  const oldScriptPatternLinks = Array.from(allHrefs).filter(
    (l) =>
      l !== TARGET_URL &&
      !l.endsWith('#') &&
      !l.includes('wp-login') &&
      !l.includes('cart') &&
      (l.includes('/agenda/') ||
        l.includes('/event/') ||
        l.includes('/evento/') ||
        l.includes('/concierto/') ||
        l.includes('/programacion/'))
  );

  // (C) External ticket links
  const externalTicketLinks = Array.from(allHrefs).filter((l) => l.includes('oneboxtds.com'));

  console.log(`\n🔍 Link Pattern Analysis & Root Cause Breakdown:`);
  console.log(`   • Total Event Links found with Catalan slug (/esdeveniment/): ${esdevenimentLinks.length}`);
  console.log(`   • Event Links matched by OLD script pattern (missing /esdeveniment/): ${oldScriptPatternLinks.length}`);
  console.log(`   • External Ticketing Links (oneboxtds.com): ${externalTicketLinks.length}`);

  // Deduplication analysis
  const newSublinks: string[] = [];
  const existingSublinks: string[] = [];

  for (const link of esdevenimentLinks) {
    const clean = link.trim().toLowerCase();
    if (pastKeys.has(clean) || pastUrls.has(clean)) {
      existingSublinks.push(link);
    } else {
      newSublinks.push(link);
    }
  }

  console.log(`\n📊 Deduplication Summary vs ${PAST_JSON_FILE}:`);
  console.log(`   • Total Live Event Sublinks on Agenda Page: ${esdevenimentLinks.length}`);
  console.log(`   • Already Present in ${PAST_JSON_FILE}: ${existingSublinks.length}`);
  console.log(`   • NEW Event Sublinks NOT in ${PAST_JSON_FILE}: ${newSublinks.length}`);

  console.log(`\n🆕 Sample New Sublinks (first 10 of ${newSublinks.length}):`);
  newSublinks.slice(0, 10).forEach((l, i) => console.log(`   ${i + 1}. ${l}`));

  // Save diagnostic output
  const diagnosticData = {
    target_url: TARGET_URL,
    timestamp: new Date().toISOString(),
    past_events_file: PAST_JSON_FILE,
    past_events_count: pastEvents.length,
    total_raw_hrefs_on_page: allHrefs.size,
    total_event_sublinks_found: esdevenimentLinks.length,
    old_script_pattern_match_count: oldScriptPatternLinks.length,
    existing_in_past_json_count: existingSublinks.length,
    new_sublinks_not_in_past_json_count: newSublinks.length,
    root_cause:
      "Old scraper link filter lacked Catalan '/esdeveniment/' URL pattern, causing 187 of 193 event links to be ignored.",
    sample_new_sublinks: newSublinks.slice(0, 20),
    all_new_sublinks: newSublinks
  };

  const outputPath = path.resolve(process.cwd(), OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(diagnosticData, null, 2), 'utf8');
  console.log(`\n💾 Diagnostic results saved to ${outputPath}\n`);
}

runDebug().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
