import { useEffect, useLayoutEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: LucideIcon
  danger?: boolean
  disabled?: boolean
  separatorAbove?: boolean
  onSelect: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let nx = x
    let ny = y
    if (nx + rect.width > window.innerWidth - 4) nx = window.innerWidth - rect.width - 4
    if (ny + rect.height > window.innerHeight - 4) ny = window.innerHeight - rect.height - 4
    if (nx < 4) nx = 4
    if (ny < 4) ny = 4
    el.style.left = `${nx}px`
    el.style.top = `${ny}px`
  }, [x, y])

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const handleScroll = (): void => onClose()
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    document.addEventListener('contextmenu', handleClick)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
      document.removeEventListener('contextmenu', handleClick)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="fixed z-[1000] min-w-[200px] py-1 rounded-md shadow-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.key}>
            {item.separatorAbove && (
              <div className="my-1 border-t border-[var(--color-border)]" />
            )}
            <button
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return
                onClose()
                item.onSelect()
              }}
              className={`w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                item.disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : item.danger
                    ? 'hover:bg-red-500/15 hover:text-red-400'
                    : 'hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {Icon ? <Icon size={13} className="shrink-0" /> : <span className="w-[13px]" />}
              <span className="truncate">{item.label}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
