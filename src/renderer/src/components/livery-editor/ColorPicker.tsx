import { useState, useCallback } from 'react'

interface ColorPickerProps {
  color: string
  onChange: (color: string) => void
  label?: string
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100
  l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

const PRESET_COLORS = [
  '#ff0000', '#ff4400', '#ff8800', '#ffcc00', '#ffff00', '#88ff00',
  '#00ff00', '#00ff88', '#00ffff', '#0088ff', '#0000ff', '#8800ff',
  '#ff00ff', '#ff0088', '#ffffff', '#cccccc', '#888888', '#444444',
  '#000000', '#8b4513', '#ff6347', '#ffa07a', '#dda0dd', '#90ee90'
]

export function ColorPicker({ color, onChange, label }: ColorPickerProps): React.JSX.Element {
  const [hexInput, setHexInput] = useState(color)
  const hsl = hexToHsl(color)

  const handleHexChange = useCallback((val: string) => {
    setHexInput(val)
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      onChange(val)
    }
  }, [onChange])

  const handleHueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = hslToHex(Number(e.target.value), hsl.s, hsl.l)
    setHexInput(newHex)
    onChange(newHex)
  }, [hsl.s, hsl.l, onChange])

  const handleSatChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = hslToHex(hsl.h, Number(e.target.value), hsl.l)
    setHexInput(newHex)
    onChange(newHex)
  }, [hsl.h, hsl.l, onChange])

  const handleLightChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = hslToHex(hsl.h, hsl.s, Number(e.target.value))
    setHexInput(newHex)
    onChange(newHex)
  }, [hsl.h, hsl.s, onChange])

  return (
    <div className="flex flex-col gap-2">
      {label && <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>}

      {/* Current color preview + hex input */}
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded border border-white/20 shrink-0"
          style={{ backgroundColor: color }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={(e) => handleHexChange(e.target.value)}
          className="flex-1 px-2 py-1 text-xs rounded bg-black/30 border border-white/10 text-white font-mono focus:border-[var(--color-accent)] focus:outline-none"
          maxLength={7}
        />
      </div>

      {/* Hue slider */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-slate-500">Hue</span>
        <input
          type="range" min={0} max={360} value={hsl.h}
          onChange={handleHueChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)'
          }}
        />
      </div>

      {/* Saturation slider */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-slate-500">Saturation</span>
        <input
          type="range" min={0} max={100} value={hsl.s}
          onChange={handleSatChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${hslToHex(hsl.h, 0, hsl.l)}, ${hslToHex(hsl.h, 100, hsl.l)})`
          }}
        />
      </div>

      {/* Lightness slider */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-slate-500">Lightness</span>
        <input
          type="range" min={0} max={100} value={hsl.l}
          onChange={handleLightChange}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #000000, ${hslToHex(hsl.h, hsl.s, 50)}, #ffffff)`
          }}
        />
      </div>

      {/* Preset swatches */}
      <div className="grid grid-cols-8 gap-1 mt-1">
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { onChange(c); setHexInput(c) }}
            className="w-5 h-5 rounded border border-white/10 hover:border-white/40 transition-colors"
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
    </div>
  )
}
