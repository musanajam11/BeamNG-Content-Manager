import { useMemo } from 'react'

/**
 * BeamMP color and style code renderer.
 *
 * Color codes: ^0–^f (hex colors)
 * Style codes: ^l (bold), ^o (italic), ^n (underline), ^m (strikethrough), ^r (reset)
 */

// Matches discord.gg/xxxx, discord.com/invite/xxxx, http(s):// URLs.
// Unicode-safe: stops at whitespace and common punctuation that wouldn't appear in URLs.
const URL_REGEX = /(https?:\/\/[^\s<>"'`]+|(?:www\.)?discord\.(?:gg|com\/invite)\/[A-Za-z0-9-]+)/gi

function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://${raw}`
}

function renderTextWithLinks(text: string, baseKey: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  URL_REGEX.lastIndex = 0
  let i = 0
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index))
    }
    const url = match[0]
    out.push(
      <a
        key={`${baseKey}-link-${i++}`}
        href={normalizeUrl(url)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-accent-text)] underline hover:opacity-80"
        onClick={(e) => e.stopPropagation()}
      >
        {url}
      </a>
    )
    lastIndex = match.index + url.length
  }
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex))
  }
  return out
}

const COLOR_MAP: Record<string, string> = {
  '0': '#000000', // Black
  '1': '#0000AA', // Dark Blue
  '2': '#00AA00', // Dark Green
  '3': '#00AAAA', // Dark Aqua
  '4': '#AA0000', // Dark Red
  '5': '#AA00AA', // Dark Purple
  '6': '#FFAA00', // Gold
  '7': '#AAAAAA', // Gray
  '8': '#555555', // Dark Gray
  '9': '#5555FF', // Blue
  a: '#55FF55', // Green
  b: '#55FFFF', // Aqua
  c: '#FF5555', // Red
  d: '#FF55FF', // Light Purple
  e: '#FFFF55', // Yellow
  f: '#FFFFFF'  // White
}

interface StyledSegment {
  text: string
  color?: string
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
}

function parseBeamMP(raw: string): StyledSegment[] {
  const segments: StyledSegment[] = []
  let color: string | undefined
  let bold = false
  let italic = false
  let underline = false
  let strikethrough = false
  let i = 0
  let buf = ''

  while (i < raw.length) {
    if (raw[i] === '^' && i + 1 < raw.length) {
      const code = raw[i + 1].toLowerCase()
      if (code in COLOR_MAP || 'rlonm'.includes(code)) {
        // Flush buffer
        if (buf) {
          segments.push({ text: buf, color, bold, italic, underline, strikethrough })
          buf = ''
        }
        if (code in COLOR_MAP) {
          color = COLOR_MAP[code]
        } else if (code === 'r') {
          color = undefined
          bold = false
          italic = false
          underline = false
          strikethrough = false
        } else if (code === 'l') {
          bold = true
        } else if (code === 'o') {
          italic = true
        } else if (code === 'n') {
          underline = true
        } else if (code === 'm') {
          strikethrough = true
        }
        i += 2
        continue
      }
    }
    buf += raw[i]
    i++
  }
  if (buf) {
    segments.push({ text: buf, color, bold, italic, underline, strikethrough })
  }
  return segments
}

interface BeamMPTextProps {
  text: string
  className?: string
  /** When true, http(s):// and discord.gg/.. URLs are rendered as clickable links. */
  linkify?: boolean
}

export function BeamMPText({ text, className, linkify = false }: BeamMPTextProps): React.JSX.Element {
  const segments = useMemo(() => parseBeamMP(text), [text])

  // If no formatting codes found, render plain (optionally linkifying URLs)
  if (segments.length === 1 && !segments[0].color && !segments[0].bold && !segments[0].italic && !segments[0].underline && !segments[0].strikethrough) {
    return <span className={className}>{linkify ? renderTextWithLinks(text, 'plain') : text}</span>
  }

  return (
    <span className={className}>
      {segments.map((seg, i) => {
        const style: React.CSSProperties = {}
        if (seg.color) style.color = seg.color
        if (seg.bold) style.fontWeight = 'bold'
        if (seg.italic) style.fontStyle = 'italic'
        const decorations: string[] = []
        if (seg.underline) decorations.push('underline')
        if (seg.strikethrough) decorations.push('line-through')
        if (decorations.length) style.textDecoration = decorations.join(' ')

        return (
          <span key={i} style={style}>
            {linkify ? renderTextWithLinks(seg.text, `seg-${i}`) : seg.text}
          </span>
        )
      })}
    </span>
  )
}
