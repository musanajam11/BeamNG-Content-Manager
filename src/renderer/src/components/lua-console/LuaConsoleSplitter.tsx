import { useCallback, useEffect, useRef } from 'react'
import { GripHorizontal } from 'lucide-react'

interface Props {
  onResize: (deltaY: number) => void
  onCollapseOutput: () => void
  onExpandOutput: () => void
  onResetOutput: () => void
  outputCollapsed: boolean
}

/**
 * Horizontal split bar between editor and output panel. Drag to resize,
 * double-click to reset to default proportions.
 */
export function LuaConsoleSplitter(p: Props): React.JSX.Element {
  const draggingRef = useRef(false)
  const lastYRef = useRef(0)
  const onResizeRef = useRef(p.onResize)
  useEffect(() => { onResizeRef.current = p.onResize }, [p.onResize])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true
    lastYRef.current = e.clientY
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    function move(e: MouseEvent): void {
      if (!draggingRef.current) return
      const dy = e.clientY - lastYRef.current
      lastYRef.current = e.clientY
      if (dy !== 0) onResizeRef.current(dy)
    }
    function up(): void {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      onMouseDown={handleMouseDown}
      onDoubleClick={p.onResetOutput}
      className="group h-1.5 shrink-0 bg-[var(--color-border)] hover:bg-[var(--color-accent)] cursor-row-resize relative flex items-center justify-center transition-colors"
      title="Drag to resize · Double-click to reset"
    >
      <GripHorizontal
        size={12}
        className="text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 absolute pointer-events-none"
      />
      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); p.outputCollapsed ? p.onExpandOutput() : p.onCollapseOutput() }}
          onMouseDown={(e) => e.stopPropagation()}
          className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-[var(--color-bg)] text-[var(--color-text-secondary)] hover:text-[var(--color-accent-text-muted)] border border-[var(--color-border)]"
        >
          {p.outputCollapsed ? 'Show output' : 'Hide output'}
        </button>
      </div>
    </div>
  )
}
