const fs = require('fs');
const path = require('path');
const locale = process.argv[2];
if (!locale) { console.error('Usage: node merge-locale.js <locale>'); process.exit(1); }
const localeDir = path.join(__dirname, 'src/renderer/src/i18n/locales');
const targetFile = path.join(localeDir, `${locale}.json`);
const patchFile = path.join(__dirname, `patch-${locale}.json`);
const target = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
const patch = JSON.parse(fs.readFileSync(patchFile, 'utf8'));
function deepMerge(t, s) {
  for (const k of Object.keys(s)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (typeof s[k] === 'object' && s[k] !== null && !Array.isArray(s[k])) {
      if (!t[k]) t[k] = {};
      deepMerge(t[k], s[k]);
    } else { t[k] = s[k]; }
  }
  return t;
}
deepMerge(target, patch);
// Reorder keys to match en.json order
const en = JSON.parse(fs.readFileSync(path.join(localeDir, 'en.json'), 'utf8'));
function reorder(enObj, targetObj) {
  const result = {};
  for (const k of Object.keys(enObj)) {
    if (!(k in targetObj)) continue;
    if (typeof enObj[k] === 'object' && enObj[k] !== null) {
      result[k] = reorder(enObj[k], targetObj[k]);
    } else { result[k] = targetObj[k]; }
  }
  return result;
}
const ordered = reorder(en, target);
fs.writeFileSync(targetFile, JSON.stringify(ordered, null, 2) + '\n', 'utf8');
function countKeys(obj, prefix='') {
  let keys = [];
  for (const [k,v] of Object.entries(obj)) {
    const p = prefix ? prefix+'.'+k : k;
    if (typeof v === 'object' && v !== null) keys.push(...countKeys(v, p));
    else keys.push(p);
  }
  return keys;
}
const enKeys = countKeys(en);
const tKeys = countKeys(ordered);
const missing = enKeys.filter(k => !tKeys.includes(k));
console.log(`${locale}: ${tKeys.length}/${enKeys.length} keys (${missing.length} still missing)`);
if (missing.length > 0) console.log('Missing:', missing.join(', '));
