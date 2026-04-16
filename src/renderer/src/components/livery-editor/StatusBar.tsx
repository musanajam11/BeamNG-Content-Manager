import { useLiveryStore } from '../../stores/useLiveryStore'

export function LiveryStatusBar(): React.JSX.Element {
  const vehicleDisplayName = useLiveryStore((s) => s.vehicleDisplayName)
  const templateWidth = useLiveryStore((s) => s.templateWidth)
  const templateHeight = useLiveryStore((s) => s.templateHeight)
  const zoom = useLiveryStore((s) => s.zoom)
  const activeTool = useLiveryStore((s) => s.activeTool)
  const layers = useLiveryStore((s) => s.layers)
  const projectDirty = useLiveryStore((s) => s.projectDirty)

  return (
    <div className="flex items-center justify-between px-3 py-1 border-t border-white/10 bg-[var(--color-surface)]/60 text-[10px] text-slate-500 shrink-0">
      <div className="flex items-center gap-3">
        {vehicleDisplayName && (
          <span>
            Vehicle: <span className="text-slate-300">{vehicleDisplayName}</span>
          </span>
        )}
        <span>
          Canvas: <span className="text-slate-300">{templateWidth} × {templateHeight}</span>
        </span>
        <span>
          Tool: <span className="text-slate-300 capitalize">{activeTool}</span>
        </span>
        <span>
          Layers: <span className="text-slate-300">{layers.length}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        {projectDirty && (
          <span className="text-amber-400">● Unsaved changes</span>
        )}
        <span>
          Zoom: <span className="text-slate-300">{Math.round(zoom * 100)}%</span>
        </span>
      </div>
    </div>
  )
}
