import { useState } from 'react'
import { Eye, EyeOff, Lock, Unlock, Plus, Trash2, GripVertical, Edit3, Check } from 'lucide-react'
import { useLiveryStore, type LayerInfo } from '../../stores/useLiveryStore'

interface LayerPanelProps {
  onLayerSelect: (layerId: string) => void
  onLayerAdd: () => void
  onLayerRemove: (layerId: string) => void
}

export function LayerPanel({ onLayerSelect, onLayerAdd, onLayerRemove }: LayerPanelProps): React.JSX.Element {
  const layers = useLiveryStore((s) => s.layers)
  const activeLayerId = useLiveryStore((s) => s.activeLayerId)
  const setLayerVisibility = useLiveryStore((s) => s.setLayerVisibility)
  const setLayerLocked = useLiveryStore((s) => s.setLayerLocked)
  const setLayerOpacity = useLiveryStore((s) => s.setLayerOpacity)
  const renameLayer = useLiveryStore((s) => s.renameLayer)
  const reorderLayers = useLiveryStore((s) => s.reorderLayers)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  const handleRenameStart = (layer: LayerInfo): void => {
    setEditingId(layer.id)
    setEditValue(layer.name)
  }

  const handleRenameConfirm = (): void => {
    if (editingId && editValue.trim()) {
      renameLayer(editingId, editValue.trim())
    }
    setEditingId(null)
  }

  const handleDragStart = (idx: number): void => {
    setDragIdx(idx)
  }

  const handleDragOver = (e: React.DragEvent, idx: number): void => {
    e.preventDefault()
    setDropIdx(idx)
  }

  const handleDrop = (idx: number): void => {
    if (dragIdx === null || dragIdx === idx) { setDragIdx(null); setDropIdx(null); return }
    const newLayers = [...layers]
    const [moved] = newLayers.splice(dragIdx, 1)
    newLayers.splice(idx, 0, moved)
    reorderLayers(newLayers)
    setDragIdx(null)
    setDropIdx(null)
  }

  // Display in reverse so top layer is at top of panel
  const displayLayers = [...layers].reverse()

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Layers</span>
        <button
          onClick={onLayerAdd}
          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="Add Layer"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto">
        {displayLayers.length === 0 && (
          <div className="flex items-center justify-center py-8 text-slate-600 text-xs">
            No layers — click + to add
          </div>
        )}
        {displayLayers.map((layer) => {
          const realIdx = layers.findIndex((l) => l.id === layer.id)
          const isActive = layer.id === activeLayerId
          const isDragOver = dropIdx !== null && layers.findIndex((l) => l.id === layer.id) === dropIdx

          return (
            <div
              key={layer.id}
              draggable
              onDragStart={() => handleDragStart(realIdx)}
              onDragOver={(e) => handleDragOver(e, realIdx)}
              onDrop={() => handleDrop(realIdx)}
              onDragEnd={() => { setDragIdx(null); setDropIdx(null) }}
              onClick={() => { onLayerSelect(layer.id) }}
              className={`
                flex items-center gap-1 px-2 py-1.5 cursor-pointer transition-colors border-l-2
                ${isActive
                  ? 'bg-[var(--color-accent)]/10 border-l-[var(--color-accent)]'
                  : 'border-l-transparent hover:bg-white/5'
                }
                ${isDragOver ? 'bg-blue-500/20' : ''}
              `}
            >
              {/* Drag handle */}
              <GripVertical size={12} className="text-slate-600 shrink-0 cursor-grab" />

              {/* Visibility */}
              <button
                onClick={(e) => { e.stopPropagation(); setLayerVisibility(layer.id, !layer.visible) }}
                className="p-0.5 rounded hover:bg-white/10 text-slate-400 transition-colors"
                title={layer.visible ? 'Hide' : 'Show'}
              >
                {layer.visible ? <Eye size={12} /> : <EyeOff size={12} className="text-slate-600" />}
              </button>

              {/* Lock */}
              <button
                onClick={(e) => { e.stopPropagation(); setLayerLocked(layer.id, !layer.locked) }}
                className="p-0.5 rounded hover:bg-white/10 text-slate-400 transition-colors"
                title={layer.locked ? 'Unlock' : 'Lock'}
              >
                {layer.locked ? <Lock size={12} className="text-amber-400" /> : <Unlock size={12} />}
              </button>

              {/* Name */}
              <div className="flex-1 min-w-0">
                {editingId === layer.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleRenameConfirm(); if (e.key === 'Escape') setEditingId(null) }}
                      className="flex-1 px-1 py-0.5 text-xs bg-black/40 border border-white/20 rounded text-white focus:outline-none focus:border-[var(--color-accent)]"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button onClick={(e) => { e.stopPropagation(); handleRenameConfirm() }} className="text-green-400 hover:text-green-300">
                      <Check size={12} />
                    </button>
                  </div>
                ) : (
                  <span
                    className={`text-xs truncate block ${layer.visible ? 'text-white' : 'text-slate-500'}`}
                    onDoubleClick={(e) => { e.stopPropagation(); handleRenameStart(layer) }}
                  >
                    {layer.name}
                  </span>
                )}
              </div>

              {/* Opacity */}
              <input
                type="range" min={0} max={100}
                value={Math.round(layer.opacity * 100)}
                onChange={(e) => { e.stopPropagation(); setLayerOpacity(layer.id, Number(e.target.value) / 100) }}
                className="w-12 h-1 rounded appearance-none cursor-pointer bg-white/10"
                title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
                onClick={(e) => e.stopPropagation()}
              />

              {/* Actions */}
              <button
                onClick={(e) => { e.stopPropagation(); handleRenameStart(layer) }}
                className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-white transition-colors"
                title="Rename"
              >
                <Edit3 size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onLayerRemove(layer.id) }}
                className="p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                title="Delete Layer"
              >
                <Trash2 size={11} />
              </button>
            </div>
          )
        })}
      </div>

      {/* UV Template indicator */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-t border-white/10 bg-white/[2%]">
        <Eye size={12} className="text-slate-600" />
        <span className="text-[10px] text-slate-500">UV Template (Background)</span>
      </div>
    </div>
  )
}
