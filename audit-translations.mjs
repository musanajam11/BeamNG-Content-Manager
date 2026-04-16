import translate from 'google-translate-api-x';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, 'src/renderer/src/i18n/locales');

const LANGS = [
  { code: 'ru', name: 'Russian', gtCode: 'ru' },
  { code: 'bg', name: 'Bulgarian', gtCode: 'bg' },
  { code: 'ar', name: 'Arabic', gtCode: 'ar' },
  { code: 'fa', name: 'Farsi', gtCode: 'fa' },
  { code: 'ur', name: 'Urdu', gtCode: 'ur' },
];

function getAllEntries(obj, prefix = '') {
  let entries = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      entries = entries.concat(getAllEntries(v, full));
    } else if (typeof v === 'string') {
      entries.push([full, v]);
    }
  }
  return entries;
}

function getVal(obj, key) {
  const parts = key.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[p];
  }
  return cur;
}

// Simple similarity: ratio of common words
function similarity(a, b) {
  if (!a || !b) return 0;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  if (na === nb) return 1;
  // For non-latin scripts, compare character-level
  const ca = [...na];
  const cb = [...nb];
  const setA = new Set(ca);
  const setB = new Set(cb);
  const intersection = [...setA].filter(c => setB.has(c));
  const union = new Set([...setA, ...setB]);
  return intersection.length / union.size;
}

// Skip keys whose values are technical/non-translatable
function shouldSkip(enValue) {
  // Very short or purely technical
  if (enValue.length <= 2) return true;
  // Contains only template vars, numbers, technical strings
  if (/^[\{\}\d\s\.\:\/%\+\-\(\)]+$/.test(enValue)) return true;
  // Brand names that shouldn't be translated
  if (/^(BeamNG|BeamMP|CareerMP|RLS|2D|3D|DirectX|Vulkan|Steam|WebRTC|STUN|TURN|Lua|Tailscale|TCP|UDP)/.test(enValue) && enValue.split(' ').length <= 2) return true;
  return false;
}

async function batchTranslate(texts, targetLang) {
  // google-translate-api-x supports batch translation
  const results = [];
  const BATCH = 30;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    try {
      const res = await translate(batch, { from: 'en', to: targetLang });
      if (Array.isArray(res)) {
        results.push(...res.map(r => r.text));
      } else {
        results.push(res.text);
      }
    } catch (e) {
      // If batch fails, try individual
      for (const t of batch) {
        try {
          const r = await translate(t, { from: 'en', to: targetLang });
          results.push(r.text);
        } catch {
          results.push(null);
        }
        await sleep(200);
      }
    }
    if (i + BATCH < texts.length) await sleep(500);
  }
  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function auditLanguage(lang) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  AUDITING: ${lang.name} (${lang.code}.json) vs Google Translate`);
  console.log(`${'='.repeat(70)}`);

  const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
  const target = JSON.parse(fs.readFileSync(path.join(localesDir, `${lang.code}.json`), 'utf8'));

  const enEntries = getAllEntries(en);

  // Filter to translatable entries
  const translatable = enEntries.filter(([key, val]) => !shouldSkip(val));

  console.log(`  Total keys: ${enEntries.length}, Translatable: ${translatable.length}`);
  console.log(`  Translating via Google Translate...\n`);

  const enTexts = translatable.map(([, val]) => val);
  const gtTexts = await batchTranslate(enTexts, lang.gtCode);

  const issues = [];
  let perfect = 0;
  let acceptable = 0;
  let flagged = 0;
  let missing = 0;

  for (let i = 0; i < translatable.length; i++) {
    const [key, enVal] = translatable[i];
    const currentVal = getVal(target, key);
    const gtVal = gtTexts[i];

    if (!currentVal) {
      issues.push({ key, enVal, currentVal: '(MISSING)', gtVal, severity: 'MISSING' });
      missing++;
      continue;
    }

    if (!gtVal) continue; // Google Translate failed

    // Strip template vars for comparison
    const stripVars = s => s.replace(/\{\{[^}]+\}\}/g, '').replace(/<[^>]+>/g, '').trim();
    const currentClean = stripVars(currentVal);
    const gtClean = stripVars(gtVal);

    const sim = similarity(currentClean, gtClean);

    if (sim >= 0.7) {
      perfect++;
    } else if (sim >= 0.35) {
      acceptable++;
    } else {
      // Low similarity - flag for review
      issues.push({ key, enVal, currentVal, gtVal, severity: 'REVIEW', sim: Math.round(sim * 100) });
      flagged++;
    }
  }

  // Print summary
  console.log(`  Results for ${lang.name}:`);
  console.log(`    ✓ Close match:  ${perfect}`);
  console.log(`    ~ Acceptable:   ${acceptable}`);
  console.log(`    ⚠ Flagged:      ${flagged}`);
  if (missing > 0) console.log(`    ✗ Missing:      ${missing}`);
  console.log();

  if (issues.length > 0) {
    console.log(`  Flagged translations (low similarity to Google Translate):`);
    console.log(`  ${'─'.repeat(66)}`);
    for (const issue of issues) {
      console.log(`  KEY: ${issue.key}${issue.sim !== undefined ? ` (${issue.sim}% similar)` : ''}`);
      console.log(`    EN:      ${issue.enVal}`);
      console.log(`    Current: ${issue.currentVal}`);
      console.log(`    Google:  ${issue.gtVal}`);
      console.log();
    }
  }

  return { lang: lang.name, perfect, acceptable, flagged, missing, issues };
}

async function main() {
  console.log('Translation Audit: Comparing locale files against Google Translate');
  console.log('Date: ' + new Date().toISOString().split('T')[0]);
  console.log();

  const results = [];
  for (const lang of LANGS) {
    const result = await auditLanguage(lang);
    results.push(result);
  }

  console.log(`\n${'='.repeat(70)}`);
  console.log('  SUMMARY');
  console.log(`${'='.repeat(70)}`);
  console.log('  Language    | Close | Acceptable | Flagged | Missing');
  console.log('  -----------|-------|------------|---------|--------');
  for (const r of results) {
    console.log(`  ${r.lang.padEnd(11)}| ${String(r.perfect).padStart(5)} | ${String(r.acceptable).padStart(10)} | ${String(r.flagged).padStart(7)} | ${String(r.missing).padStart(7)}`);
  }

  // Write detailed report
  const report = { date: new Date().toISOString(), results };
  fs.writeFileSync(
    path.join(__dirname, 'translation-audit-report.json'),
    JSON.stringify(report, null, 2)
  );
  console.log('\nDetailed report saved to translation-audit-report.json');
}

main().catch(e => { console.error(e); process.exit(1); });
