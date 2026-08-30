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

const TARGET_URL = process.argv[2] || 'https://wolfbarcelona.com/conciertos/';
const OUTPUT_FILE = process.argv[3] || 'crawled_output.json';

console.log('\n===============================================================');
console.log(' 🐺 Wolf Barcelona Event Extraction Diagnostic Script');
console.log('===============================================================');
console.log(`📍 Target URL: ${TARGET_URL}`);
console.log(`💾 Output File: ${OUTPUT_FILE}\n`);

async function runDiagnostics() {
  const diagnostics: Record<string, unknown> = {
    url: TARGET_URL,
    timestamp: new Date().toISOString(),
    html_length: 0,
    title: '',
    extracted_events: []
  };

  console.log('1️⃣ Executing extractAllRawEventsAlternativeD via lib/discover.ts...');
  try {
    const { extractAllRawEventsAlternativeD } = await import('../lib/discover');
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
    console.error(`   ❌ Gemini raw event extraction error:`, geminiErr);
  }

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
