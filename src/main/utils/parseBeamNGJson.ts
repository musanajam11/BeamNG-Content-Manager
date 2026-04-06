/**
 * Parses BeamNG's "relaxed JSON" format used in .pc, .jbeam, info.json files.
 *
 * Differences from strict JSON:
 *  - Single-line (//) and block comments are allowed
 *  - Trailing commas before } or ] are allowed
 *  - Missing commas between properties/elements are tolerated (same-line and cross-line)
 *  - Stray commas after colons (e.g. "key":, {) are removed
 */
export function parseBeamNGJson<T = unknown>(text: string): T {
  // Fast path: try parsing as-is first (handles well-formed .pc files)
  try {
    return JSON.parse(text)
  } catch {
    // Fall through to relaxed parsing
  }

  // 1. Strip single-line and block comments (but not inside strings)
  let cleaned = ''
  let i = 0
  let inString = false
  while (i < text.length) {
    const ch = text[i]
    if (inString) {
      cleaned += ch
      if (ch === '\\') {
        // Escaped char — copy next char verbatim
        if (i + 1 < text.length) {
          cleaned += text[i + 1]
          i += 2
          continue
        }
      } else if (ch === '"') {
        inString = false
      }
      i++
      continue
    }

    // Not in string
    if (ch === '"') {
      inString = true
      cleaned += ch
      i++
    } else if (ch === '/' && i + 1 < text.length) {
      if (text[i + 1] === '/') {
        // Skip to end of line
        const eol = text.indexOf('\n', i + 2)
        i = eol === -1 ? text.length : eol
      } else if (text[i + 1] === '*') {
        // Skip to end of block comment
        const end = text.indexOf('*/', i + 2)
        i = end === -1 ? text.length : end + 2
      } else {
        cleaned += ch
        i++
      }
    } else {
      cleaned += ch
      i++
    }
  }

  // 1b. Protect string contents from regex fixup rules.
  //     Replace the interior of each quoted string with a safe placeholder
  //     so that regex rules (especially missing-comma insertion) don't corrupt
  //     characters inside string values (e.g. digits before closing quotes).
  const strings: string[] = []
  cleaned = cleaned.replace(/"((?:[^"\\]|\\.)*)"/g, (_match, content: string) => {
    const idx = strings.length
    strings.push(content)
    return `"__S${idx}__"`
  })

  // 2. Remove stray commas after colons: "key":, value → "key": value
  cleaned = cleaned.replace(/:\s*,/g, ': ')

  // 3. Strip explicit '+' sign before numbers (JSON doesn't allow +4, only -4)
  cleaned = cleaned.replace(/([\[:,\[]\s*)\+(\d)/g, '$1$2')

  // 4. Fix unterminated fractional numbers: 1. → 1.0
  cleaned = cleaned.replace(/(\d+)\.([\s,\]\}])/g, '$1.0$2')

  // 5. Strip leading zeros from numbers: 06 → 6, 00 → 0 (JSON forbids 06/09/00)
  cleaned = cleaned.replace(/([\[:,\[\s])0+(\d)/g, '$1$2')

  // 6. Remove leading commas after [ or { : [, → [  and {, → {
  cleaned = cleaned.replace(/([\[{])\s*,/g, '$1')

  // 7. Collapse duplicate commas with optional whitespace: ,  , → ,
  cleaned = cleaned.replace(/,\s*,/g, ',')

  // 8. Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1')

  // 9. Insert missing commas between adjacent values (same-line and cross-line)
  //    Run multiple passes until stable (handles cascading adjacencies)
  let prev: string
  do {
    prev = cleaned
    // After ] or } → before value start (", {, [, digit, -, true, false, null)
    cleaned = cleaned.replace(
      /([}\]])(\s*)(["{\[0-9\-]|true\b|false\b|null\b)/g,
      '$1,$2$3'
    )
    // After " + whitespace (at least one char including newline) → before value start
    // Must require whitespace to avoid corrupting "" (empty string) or ":"
    cleaned = cleaned.replace(
      /"(\s+)(["{\[0-9\-]|true\b|false\b|null\b)/g,
      (match, ws: string, next: string) => (ws.includes(':') ? match : '",' + ws + next)
    )
    // After alphanumeric/underscore then " directly touching { or [ or " — missing comma
    // e.g. "bd4ll"{"key":1} or "rb1ll""rb4," but NOT ":"{ which is valid JSON
    cleaned = cleaned.replace(/(\w)"([{\["])/g, '$1",$2')
    // After digit + whitespace → before value start, but NOT when : appears between
    cleaned = cleaned.replace(
      /(\d)(\s+)(?=["{\[0-9\-]|true\b|false\b|null\b)/g,
      (match, d: string, ws: string) => (ws.includes(':') ? match : d + ',' + ws)
    )
    // After digit directly touching { or [ or " (no whitespace) — always a missing comma
    cleaned = cleaned.replace(/(\d)(?=["{\[])/g, '$1,')
    // After true/false/null → before value start
    cleaned = cleaned.replace(
      /(true|false|null)(\s+)(?=["{\[0-9\-]|true\b|false\b|null\b)/g,
      '$1,$2'
    )
  } while (cleaned !== prev)

  // 10. Restore original string contents
  cleaned = cleaned.replace(/"__S(\d+)__"/g, (_match, idx: string) => `"${strings[parseInt(idx)]}"`)

  try {
    return JSON.parse(cleaned)
  } catch (e) {
    // Some jbeam files have trailing content after the root object — trim to last }
    if (e instanceof SyntaxError && e.message.includes('after JSON')) {
      const lastBrace = cleaned.lastIndexOf('}')
      if (lastBrace >= 0) {
        return JSON.parse(cleaned.slice(0, lastBrace + 1))
      }
    }
    throw e
  }
}
