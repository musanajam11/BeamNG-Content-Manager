import { useState, useRef, useEffect } from 'react'
import { Bold, Italic, Underline, Strikethrough, Eraser, Palette, Code } from 'lucide-react'
import { BeamMPText } from '../BeamMPText'
import { useTranslation } from 'react-i18next'

/* ── colour table ──────────────────────────────────────────────── */

const COLORS: { code: string; hex: string; label: string }[] = [
  { code: '0', hex: '#000000', label: 'Black' },
  { code: '1', hex: '#0000AA', label: 'Dark Blue' },
  { code: '2', hex: '#00AA00', label: 'Dark Green' },
  { code: '3', hex: '#00AAAA', label: 'Dark Aqua' },
  { code: '4', hex: '#AA0000', label: 'Dark Red' },
  { code: '5', hex: '#AA00AA', label: 'Dark Purple' },
  { code: '6', hex: '#FFAA00', label: 'Gold' },
  { code: '7', hex: '#AAAAAA', label: 'Gray' },
  { code: '8', hex: '#555555', label: 'Dark Gray' },
  { code: '9', hex: '#5555FF', label: 'Blue' },
  { code: 'a', hex: '#55FF55', label: 'Green' },
  { code: 'b', hex: '#55FFFF', label: 'Aqua' },
  { code: 'c', hex: '#FF5555', label: 'Red' },
  { code: 'd', hex: '#FF55FF', label: 'Light Purple' },
  { code: 'e', hex: '#FFFF55', label: 'Yellow' },
  { code: 'f', hex: '#FFFFFF', label: 'White' }
]

const CODE_HEX: Record<string, string> = Object.fromEntries(COLORS.map((c) => [c.code, c.hex]))

/* ── character model ───────────────────────────────────────────── */

interface CharStyle {
  color?: string // '0'–'f'
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
}

interface StyledChar {
  ch: string
  style: CharStyle
}

const PLAIN: CharStyle = { bold: false, italic: false, underline: false, strike: false }

function sameStyle(a: CharStyle, b: CharStyle): boolean {
  return (
    a.color === b.color &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.strike === b.strike
  )
}

/* ── parse BeamMP coded string → model ─────────────────────────── */

function parseModel(raw: string): StyledChar[] {
  const chars: StyledChar[] = []
  let style: CharStyle = { ...PLAIN }
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '^' && i + 1 < raw.length) {
      const c = raw[i + 1].toLowerCase()
      if (c in CODE_HEX) {
        style = { ...style, color: c }
        i += 2
        continue
      }
      if (c === 'l') { style = { ...style, bold: true }; i += 2; continue }
      if (c === 'o') { style = { ...style, italic: true }; i += 2; continue }
      if (c === 'n') { style = { ...style, underline: true }; i += 2; continue }
      if (c === 'm') { style = { ...style, strike: true }; i += 2; continue }
      if (c === 'r') { style = { ...PLAIN }; i += 2; continue }
    }
    chars.push({ ch: raw[i], style: { ...style } })
    i++
  }
  return chars
}

/* ── model → BeamMP codes ──────────────────────────────────────── */

function modelToCodes(chars: StyledChar[]): string {
  let out = ''
  let cur: CharStyle = { ...PLAIN }

  for (const { ch, style } of chars) {
    // Need ^r reset if any toggle must be turned OFF, or colour must be cleared
    const mustReset =
      (cur.bold && !style.bold) ||
      (cur.italic && !style.italic) ||
      (cur.underline && !style.underline) ||
      (cur.strike && !style.strike) ||
      (cur.color != null && style.color == null)

    if (mustReset) {
      out += '^r'
      cur = { ...PLAIN }
    }

    if (style.color != null && style.color !== cur.color) {
      out += `^${style.color}`
      cur = { ...cur, color: style.color }
    }
    if (style.bold && !cur.bold) { out += '^l'; cur = { ...cur, bold: true } }
    if (style.italic && !cur.italic) { out += '^o'; cur = { ...cur, italic: true } }
    if (style.underline && !cur.underline) { out += '^n'; cur = { ...cur, underline: true } }
    if (style.strike && !cur.strike) { out += '^m'; cur = { ...cur, strike: true } }

    out += ch
  }
  return out
}

/* ── model → HTML spans for contentEditable ────────────────────── */

function modelToHtml(chars: StyledChar[]): string {
  if (!chars.length) return ''
  let html = ''
  let i = 0
  while (i < chars.length) {
    const s = chars[i].style
    let text = ''
    while (i < chars.length && sameStyle(chars[i].style, s)) {
      text += chars[i].ch
      i++
    }
    const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const css = buildCss(s)
    html += css ? `<span style="${css}">${esc}</span>` : esc
  }
  return html
}

function buildCss(s: CharStyle): string {
  const p: string[] = []
  if (s.color) p.push(`color:${CODE_HEX[s.color]}`)
  if (s.bold) p.push('font-weight:bold')
  if (s.italic) p.push('font-style:italic')
  const d: string[] = []
  if (s.underline) d.push('underline')
  if (s.strike) d.push('line-through')
  if (d.length) p.push(`text-decoration:${d.join(' ')}`)
  return p.join(';')
}

/* ── DOM selection helpers ─────────────────────────────────────── */

function charOffset(root: HTMLElement, node: Node, off: number): number {
  const r = document.createRange()
  r.setStart(root, 0)
  r.setEnd(node, off)
  return r.toString().length
}

function getSel(root: HTMLElement): { start: number; end: number } | null {
  const s = window.getSelection()
  if (!s || !s.rangeCount || !root.contains(s.anchorNode)) return null
  const r = s.getRangeAt(0)
  return {
    start: charOffset(root, r.startContainer, r.startOffset),
    end: charOffset(root, r.endContainer, r.endOffset)
  }
}

function setSel(root: HTMLElement, start: number, end: number): void {
  const s = window.getSelection()
  if (!s) return
  const find = (target: number): { node: Node; off: number } | null => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let count = 0
    let n: Node | null
    while ((n = w.nextNode())) {
      const len = (n as Text).length
      if (count + len >= target) return { node: n, off: target - count }
      count += len
    }
    return null
  }
  const a = find(start)
  const b = find(end)
  if (!a) {
    const r = document.createRange()
    r.setStart(root, 0)
    r.collapse(true)
    s.removeAllRanges()
    s.addRange(r)
    return
  }
  const r = document.createRange()
  r.setStart(a.node, a.off)
  r.setEnd(b?.node ?? a.node, b?.off ?? a.off)
  s.removeAllRanges()
  s.addRange(r)
}

/* ── component ─────────────────────────────────────────────────── */

interface BeamMPNameEditorProps {
  value: string
  onChange: (value: string) => void
  error?: string
}

export function BeamMPNameEditor({ value, onChange, error }: BeamMPNameEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const editorRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<StyledChar[]>(parseModel(value))
  const [rawMode, setRawMode] = useState(false)
  const [showColors, setShowColors] = useState(false)
  const focusedRef = useRef(false)
  const composingRef = useRef(false)
  const renderingRef = useRef(false)
  const lastEmitRef = useRef(value)

  /* sync external value → model (only while not editing) */
  useEffect(() => {
    if (value === lastEmitRef.current) return
    lastEmitRef.current = value
    if (focusedRef.current) return
    modelRef.current = parseModel(value)
    renderHtml()
  }, [value])

  /* re-render when switching back from raw mode */
  useEffect(() => {
    if (!rawMode) {
      modelRef.current = parseModel(value)
      renderHtml()
    }
  }, [rawMode])

  /* ── render & emit ──────────────────────────────────────────── */

  function renderHtml(sel?: { start: number; end: number }): void {
    if (!editorRef.current) return
    renderingRef.current = true
    editorRef.current.innerHTML = modelToHtml(modelRef.current)
    if (sel) setSel(editorRef.current, sel.start, sel.end)
    renderingRef.current = false
  }

  function emit(): void {
    const codes = modelToCodes(modelRef.current)
    lastEmitRef.current = codes
    onChange(codes)
  }

  /* ── handle text input (typing / delete / paste) ────────────── */

  function handleInput(): void {
    if (renderingRef.current || composingRef.current || !editorRef.current) return

    const newText = editorRef.current.textContent ?? ''
    const oldText = modelRef.current.map((c) => c.ch).join('')
    if (newText === oldText) return

    // Save cursor BEFORE we re-render
    const sel = getSel(editorRef.current)
    const cursor = sel?.end ?? newText.length

    // Diff: longest common prefix & suffix
    let pre = 0
    while (pre < oldText.length && pre < newText.length && oldText[pre] === newText[pre]) pre++
    let suf = 0
    while (
      suf < oldText.length - pre &&
      suf < newText.length - pre &&
      oldText[oldText.length - 1 - suf] === newText[newText.length - 1 - suf]
    ) suf++

    const delCount = oldText.length - pre - suf
    const insText = newText.slice(pre, newText.length - suf)

    // Apply to model
    if (delCount > 0) modelRef.current.splice(pre, delCount)
    if (insText.length > 0) {
      const inherit =
        modelRef.current[pre - 1]?.style ?? modelRef.current[pre]?.style ?? { ...PLAIN }
      const newChars: StyledChar[] = [...insText].map((ch) => ({ ch, style: { ...inherit } }))
      modelRef.current.splice(pre, 0, ...newChars)
    }

    emit()
    renderHtml({ start: cursor, end: cursor })
  }

  /* ── toolbar actions (model-based, no execCommand) ──────────── */

  function toggleStyle(key: 'bold' | 'italic' | 'underline' | 'strike'): void {
    if (!editorRef.current) return
    const sel = getSel(editorRef.current)
    if (!sel || sel.start >= sel.end) return // nothing highlighted

    const slice = modelRef.current.slice(sel.start, sel.end)
    const allOn = slice.every((c) => c.style[key])

    for (let i = sel.start; i < sel.end; i++) {
      modelRef.current[i] = {
        ...modelRef.current[i],
        style: { ...modelRef.current[i].style, [key]: !allOn }
      }
    }

    emit()
    renderHtml(sel)
  }

  function applyColor(code: string): void {
    if (!editorRef.current) return
    const sel = getSel(editorRef.current)
    if (!sel || sel.start >= sel.end) return

    for (let i = sel.start; i < sel.end; i++) {
      modelRef.current[i] = {
        ...modelRef.current[i],
        style: { ...modelRef.current[i].style, color: code }
      }
    }

    emit()
    renderHtml(sel)
    setShowColors(false)
  }

  function clearFormat(): void {
    if (!editorRef.current) return
    const sel = getSel(editorRef.current)
    if (!sel || sel.start >= sel.end) return

    for (let i = sel.start; i < sel.end; i++) {
      modelRef.current[i] = { ...modelRef.current[i], style: { ...PLAIN } }
    }

    emit()
    renderHtml(sel)
  }

  /* ── helpers ─────────────────────────────────────────────────── */

  const prevent = (e: React.MouseEvent): void => e.preventDefault()

  const btnCls = (on?: boolean): string =>
    `p-1.5 rounded transition-colors ${on ? 'bg-[var(--color-surface-active)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]'}`

  /* ── render ──────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-text-muted)]">{t('serverManager.serverName')}</span>

      {/* ── toolbar ── */}
      <div className="flex items-center gap-0.5 px-1 py-0.5 border border-[var(--color-border)] border-b-0 rounded-t bg-[var(--color-surface)]">
        <button type="button" onMouseDown={prevent} onClick={() => toggleStyle('bold')} title={t('serverManager.bold')} className={btnCls()}>
          <Bold size={13} />
        </button>
        <button type="button" onMouseDown={prevent} onClick={() => toggleStyle('italic')} title={t('serverManager.italic')} className={btnCls()}>
          <Italic size={13} />
        </button>
        <button type="button" onMouseDown={prevent} onClick={() => toggleStyle('underline')} title={t('serverManager.underline')} className={btnCls()}>
          <Underline size={13} />
        </button>
        <button type="button" onMouseDown={prevent} onClick={() => toggleStyle('strike')} title={t('serverManager.strikethrough')} className={btnCls()}>
          <Strikethrough size={13} />
        </button>
        <button type="button" onMouseDown={prevent} onClick={clearFormat} title={t('serverManager.clearFormatting')} className={btnCls()}>
          <Eraser size={13} />
        </button>

        <div className="w-px h-4 bg-[var(--color-surface-active)] mx-1" />

        {/* colour picker */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={prevent}
            onClick={() => setShowColors(!showColors)}
            title={t('serverManager.textColour')}
            className={btnCls(showColors)}
          >
            <Palette size={13} />
          </button>
          {showColors && (
            <div className="absolute top-full left-0 mt-1 z-50 p-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
              <div className="grid grid-cols-8 gap-1 overflow-hidden p-0.5">
                {COLORS.map(({ code, hex, label }) => (
                  <button
                    key={code}
                    type="button"
                    onMouseDown={prevent}
                    onClick={() => applyColor(code)}
                    title={`${label} (^${code})`}
                    className="w-5 h-5 rounded border border-[var(--color-border-hover)] hover:scale-125 transition-transform"
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-[var(--color-surface-active)] mx-1" />

        <button
          type="button"
          onClick={() => setRawMode(!rawMode)}
          title={rawMode ? t('serverManager.visualEditor') : t('serverManager.rawCodes')}
          className={btnCls(rawMode)}
        >
          <Code size={13} />
        </button>
      </div>

      {/* ── editor area ── */}
      {rawMode ? (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`px-2 py-1.5 text-sm bg-[var(--color-surface)] border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-accent)] outline-none rounded-b font-mono ${error ? 'border-red-500/60' : 'border-[var(--color-border)]'}`}
          placeholder={t('serverManager.serverNamePlaceholder')}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onFocus={() => { focusedRef.current = true }}
          onBlur={() => { focusedRef.current = false }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false; handleInput() }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
          onPaste={(e) => {
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain').replace(/[\r\n]/g, ' ')
            document.execCommand('insertText', false, text)
          }}
          className={`px-2 py-1.5 text-sm bg-[var(--color-surface)] border text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded-b min-h-[32px] whitespace-pre overflow-x-auto ${error ? 'border-red-500/60' : 'border-[var(--color-border)]'}`}
          style={{ minHeight: 32 }}
        />
      )}
      {error && <span className="text-[11px] text-red-400">{error}</span>}

      {/* ── previews ── */}
      {value && (
        <div className="mt-1 space-y-1 min-w-0">
          <div className="px-2 py-1.5 rounded border border-[var(--color-border)] bg-[var(--color-scrim-20)] flex items-center gap-2 min-w-0 overflow-hidden">
            <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">Preview:</span>
            <BeamMPText text={value} className="text-sm truncate block min-w-0" />
          </div>
          <div className="px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-scrim-20)] overflow-x-auto">
            <span className="text-[10px] text-[var(--color-text-muted)] mr-2">Raw:</span>
            <code className="text-[11px] text-[var(--color-text-secondary)] font-mono break-all select-all">{value}</code>
          </div>
        </div>
      )}
    </div>
  )
}
