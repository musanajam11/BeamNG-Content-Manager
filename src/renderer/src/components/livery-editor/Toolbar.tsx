import {
  MousePointer2, Pen, Eraser, Square, Circle, Minus, Triangle,
  Type, Pipette, PaintBucket, Hand, Undo2, Redo2,
  ZoomIn, ZoomOut, Save, Download, FolderOpen, ImagePlus
} from 'lucide-react'
import { useLiveryStore, type LiveryTool, type ShapeType } from '../../stores/useLiveryStore'

const TOOLS: Array<{ id: LiveryTool; icon: typeof MousePointer2; label: string; shortcut: string }> = [
  { id: 'select', icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { id: 'draw', icon: Pen, label: 'Brush', shortcut: 'B' },
  { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
  { id: 'shape', icon: Square, label: 'Shape', shortcut: 'U' },
  { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
  { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' },
  { id: 'fill', icon: PaintBucket, label: 'Fill', shortcut: 'G' },
  { id: 'pan', icon: Hand, label: 'Pan', shortcut: 'H' },
]

const SHAPES: Array<{ id: ShapeType; icon: typeof Square; label: string }> = [
  { id: 'rect', icon: Square, label: 'Rectangle' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'triangle', icon: Triangle, label: 'Triangle' },
]

interface ToolbarProps {
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  onSave: () => void
  onLoad: () => void
  onExport: () => void
  onImportImage: () => void
}

export function Toolbar({
  onUndo, onRedo, canUndo, canRedo,
  onSave, onLoad, onExport, onImportImage
}: ToolbarProps): React.JSX.Element {
  const activeTool = useLiveryStore((s) => s.activeTool)
  const shapeType = useLiveryStore((s) => s.shapeType)
  const zoom = useLiveryStore((s) => s.zoom)
  const setTool = useLiveryStore((s) => s.setTool)
  const setShapeType = useLiveryStore((s) => s.setShapeType)
  const setZoom = useLiveryStore((s) => s.setZoom)
  const brushSettings = useLiveryStore((s) => s.brushSettings)
  const setBrushSettings = useLiveryStore((s) => s.setBrushSettings)

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]/80 shrink-0">
      {/* File operations */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[var(--color-border)]">
        <ToolButton icon={Save} label="Save Project (Ctrl+S)" onClick={onSave} />
        <ToolButton icon={FolderOpen} label="Open Project" onClick={onLoad} />
        <ToolButton icon={Download} label="Export Skin Mod (Ctrl+E)" onClick={onExport} />
        <ToolButton icon={ImagePlus} label="Import Image" onClick={onImportImage} />
      </div>

      {/* Undo/Redo */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[var(--color-border)]">
        <ToolButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={onUndo} disabled={!canUndo} />
        <ToolButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" onClick={onRedo} disabled={!canRedo} />
      </div>

      {/* Drawing tools */}
      <div className="flex items-center gap-0.5 pr-2 border-r border-[var(--color-border)]">
        {TOOLS.map((tool) => (
          <ToolButton
            key={tool.id}
            icon={tool.icon}
            label={`${tool.label} (${tool.shortcut})`}
            active={activeTool === tool.id}
            onClick={() => setTool(tool.id)}
          />
        ))}
      </div>

      {/* Shape sub-tools */}
      {activeTool === 'shape' && (
        <div className="flex items-center gap-0.5 pr-2 border-r border-[var(--color-border)]">
          {SHAPES.map((shape) => (
            <ToolButton
              key={shape.id}
              icon={shape.icon}
              label={shape.label}
              active={shapeType === shape.id}
              onClick={() => setShapeType(shape.id)}
              small
            />
          ))}
        </div>
      )}

      {/* Brush size (when draw or eraser active) */}
      {(activeTool === 'draw' || activeTool === 'eraser') && (
        <div className="flex items-center gap-1.5 px-2 border-r border-[var(--color-border)]">
          <span className="text-[10px] text-[var(--color-text-muted)]">Size</span>
          <input
            type="range"
            min={1} max={100}
            value={brushSettings.size}
            onChange={(e) => setBrushSettings({ size: Number(e.target.value) })}
            className="w-20 h-1.5 rounded-full appearance-none cursor-pointer bg-[var(--color-surface-active)]"
          />
          <span className="text-[10px] text-[var(--color-text-primary)] w-5 text-right">{brushSettings.size}</span>
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        <ToolButton icon={ZoomOut} label="Zoom Out" onClick={() => setZoom(zoom / 1.2)} />
        <span className="text-[10px] text-[var(--color-text-secondary)] w-10 text-center">{Math.round(zoom * 100)}%</span>
        <ToolButton icon={ZoomIn} label="Zoom In" onClick={() => setZoom(zoom * 1.2)} />
        <button
          onClick={() => setZoom(1)}
          className="px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] rounded hover:bg-[var(--color-surface-active)] transition-colors"
        >
          Fit
        </button>
      </div>
    </div>
  )
}

function ToolButton({
  icon: Icon, label, active, disabled, onClick, small
}: {
  icon: typeof MousePointer2
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  small?: boolean
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        ${small ? 'p-1' : 'p-1.5'} rounded transition-colors
        ${active
          ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-active)] border border-transparent'
        }
        ${disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <Icon size={small ? 14 : 16} />
    </button>
  )
}
