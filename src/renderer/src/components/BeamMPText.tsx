import { useMemo } from 'react'

/**
 * BeamMP color and style code renderer.
 *
 * Color codes: ^0–^f (hex colors)
 * Style codes: ^l (bold), ^o (italic), ^n (underline), ^m (strikethrough), ^r (reset)
 */

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
}

export function BeamMPText({ text, className }: BeamMPTextProps): React.JSX.Element {
  const segments = useMemo(() => parseBeamMP(text), [text])

  // If no formatting codes found, render plain
  if (segments.length === 1 && !segments[0].color && !segments[0].bold && !segments[0].italic && !segments[0].underline && !segments[0].strikethrough) {
    return <span className={className}>{text}</span>
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
            {seg.text}
          </span>
        )
      })}
    </span>
  )
}

/** Strip all BeamMP format codes for plain-text use (search, sort, etc.) */
export function stripBeamMPCodes(s: string): string {
  return s.replace(/\^[0-9a-frlonmp]/gi, '')
}
