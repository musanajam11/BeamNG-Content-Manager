import { useEffect, useState, useCallback } from 'react'
import type { Canvas as FabricCanvas, FabricObject, FabricText } from 'fabric'
import { ColorPicker } from './ColorPicker'
import { useLiveryStore } from '../../stores/useLiveryStore'

interface PropertiesPanelProps {
  canvasRef: React.MutableRefObject<FabricCanvas | null>
}

interface ObjectProps {
  left: number
  top: number
  width: number
  height: number
  angle: number
  opacity: number
  fill: string
  stroke: string
  strokeWidth: number
  // Text-specific
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  fontStyle?: string
  textAlign?: string
  text?: string
  type?: string
}

const FONT_FAMILIES = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Times New Roman', 'Georgia', 'Courier New',
  'Impact', 'Comic Sans MS'
]

export function PropertiesPanel({ canvasRef }: PropertiesPanelProps): React.JSX.Element {
  const [selected, setSelected] = useState<ObjectProps | null>(null)
  const [selCount, setSelCount] = useState(0)
  const fillColor = useLiveryStore((s) => s.fillColor)
  const strokeColor = useLiveryStore((s) => s.strokeColor)
  const strokeWidth = useLiveryStore((s) => s.strokeWidth)
  const fontSize = useLiveryStore((s) => s.fontSize)
  const fontFamily = useLiveryStore((s) => s.fontFamily)
  const setFillColor = useLiveryStore((s) => s.setFillColor)
  const setStrokeColor = useLiveryStore((s) => s.setStrokeColor)
  const setStrokeWidth = useLiveryStore((s) => s.setStrokeWidth)
  const setFontSize = useLiveryStore((s) => s.setFontSize)
  const setFontFamily = useLiveryStore((s) => s.setFontFamily)

  const updateSelectedProps = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) { setSelected(null); setSelCount(0); return }

    const objects = canvas.getActiveObjects()
    setSelCount(objects.length)

    const obj = active as FabricObject & Partial<FabricText>
    setSelected({
      left: Math.round(obj.left ?? 0),
      top: Math.round(obj.top ?? 0),
      width: Math.round((obj.width ?? 0) * (obj.scaleX ?? 1)),
      height: Math.round((obj.height ?? 0) * (obj.scaleY ?? 1)),
      angle: Math.round(obj.angle ?? 0),
      opacity: obj.opacity ?? 1,
      fill: typeof obj.fill === 'string' ? obj.fill : '#000000',
      stroke: typeof obj.stroke === 'string' ? obj.stroke : '#000000',
      strokeWidth: obj.strokeWidth ?? 0,
      fontSize: (obj as unknown as FabricText).fontSize,
      fontFamily: (obj as unknown as FabricText).fontFamily,
      fontWeight: String((obj as unknown as FabricText).fontWeight ?? ''),
      fontStyle: (obj as unknown as FabricText).fontStyle,
      textAlign: (obj as unknown as FabricText).textAlign,
      text: (obj as unknown as FabricText).text,
      type: obj.type
    })
  }, [canvasRef])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handler = (): void => updateSelectedProps()
    canvas.on('selection:created', handler)
    canvas.on('selection:updated', handler)
    canvas.on('selection:cleared', () => { setSelected(null); setSelCount(0) })
    canvas.on('object:modified', handler)
    canvas.on('object:scaling', handler)
    canvas.on('object:moving', handler)
    canvas.on('object:rotating', handler)

    return () => {
      canvas.off('selection:created', handler)
      canvas.off('selection:updated', handler)
      canvas.off('selection:cleared')
      canvas.off('object:modified', handler)
      canvas.off('object:scaling', handler)
      canvas.off('object:moving', handler)
      canvas.off('object:rotating', handler)
    }
  }, [canvasRef, updateSelectedProps])

  const setProp = useCallback((key: string, value: unknown) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const active = canvas.getActiveObject()
    if (!active) return
    active.set(key as keyof FabricObject, value as never)
    canvas.renderAll()
    canvas.fire('object:modified', { target: active } as never)
    updateSelectedProps()
  }, [canvasRef, updateSelectedProps])

  const isText = selected?.type === 'textbox' || selected?.type === 'i-text' || selected?.type === 'text'

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] shrink-0">
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Properties</span>
      </div>

      {selected ? (
        <div className="flex flex-col gap-3 p-3">
          {/* Selection info */}
          <div className="text-[10px] text-[var(--color-text-muted)]">
            {selCount > 1 ? `${selCount} objects selected` : (selected.type ?? 'Object')}
          </div>

          {/* Position */}
          <div className="grid grid-cols-2 gap-2">
            <PropInput label="X" value={selected.left} onChange={(v) => setProp('left', v)} />
            <PropInput label="Y" value={selected.top} onChange={(v) => setProp('top', v)} />
            <PropInput label="W" value={selected.width} onChange={(v) => {
              const active = canvasRef.current?.getActiveObject()
              if (active) { active.set('scaleX', v / (active.width ?? 1)); canvasRef.current?.renderAll() }
            }} />
            <PropInput label="H" value={selected.height} onChange={(v) => {
              const active = canvasRef.current?.getActiveObject()
              if (active) { active.set('scaleY', v / (active.height ?? 1)); canvasRef.current?.renderAll() }
            }} />
          </div>

          {/* Rotation + Opacity */}
          <div className="grid grid-cols-2 gap-2">
            <PropInput label="Angle" value={selected.angle} onChange={(v) => setProp('angle', v)} suffix="°" />
            <PropInput label="Opacity" value={Math.round(selected.opacity * 100)} onChange={(v) => setProp('opacity', v / 100)} suffix="%" />
          </div>

          {/* Fill color */}
          <ColorPicker label="Fill" color={selected.fill} onChange={(c) => { setProp('fill', c); setFillColor(c) }} />

          {/* Stroke */}
          <ColorPicker label="Stroke" color={selected.stroke} onChange={(c) => { setProp('stroke', c); setStrokeColor(c) }} />
          <PropInput label="Stroke Width" value={selected.strokeWidth} onChange={(v) => { setProp('strokeWidth', v); setStrokeWidth(v) }} />

          {/* Text-specific props */}
          {isText && (
            <>
              <div className="border-t border-[var(--color-border)] pt-2">
                <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Text</span>
              </div>
              <select
                value={selected.fontFamily || fontFamily}
                onChange={(e) => { setProp('fontFamily', e.target.value); setFontFamily(e.target.value) }}
                className="px-2 py-1 text-xs rounded bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
              <PropInput
                label="Size"
                value={selected.fontSize || fontSize}
                onChange={(v) => { setProp('fontSize', v); setFontSize(v) }}
              />
              <div className="flex gap-1">
                <button
                  onClick={() => setProp('fontWeight', selected.fontWeight === 'bold' ? 'normal' : 'bold')}
                  className={`px-2 py-1 text-xs rounded border ${selected.fontWeight === 'bold' ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/30 text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  <strong>B</strong>
                </button>
                <button
                  onClick={() => setProp('fontStyle', selected.fontStyle === 'italic' ? 'normal' : 'italic')}
                  className={`px-2 py-1 text-xs rounded border ${selected.fontStyle === 'italic' ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/30 text-[var(--color-text-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}
                >
                  <em>I</em>
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="p-3">
          {/* Default tool properties when nothing selected */}
          <div className="flex flex-col gap-3">
            <div className="text-[10px] text-[var(--color-text-muted)]">No selection — default properties</div>
            <ColorPicker label="Fill Color" color={fillColor} onChange={setFillColor} />
            <ColorPicker label="Stroke Color" color={strokeColor} onChange={setStrokeColor} />
            <PropInput label="Stroke Width" value={strokeWidth} onChange={setStrokeWidth} />
            <PropInput label="Font Size" value={fontSize} onChange={setFontSize} />
            <select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              className="px-2 py-1 text-xs rounded bg-[var(--color-scrim-30)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  )
}

function PropInput({
  label, value, onChange, suffix
}: {
  label: string; value: number; onChange: (v: number) => void; suffix?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
      <div className="flex items-center">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full px-1.5 py-1 text-xs bg-[var(--color-scrim-30)] border border-[var(--color-border)] rounded text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
        />
        {suffix && <span className="text-[10px] text-[var(--color-text-muted)] ml-1">{suffix}</span>}
      </div>
    </div>
  )
}
