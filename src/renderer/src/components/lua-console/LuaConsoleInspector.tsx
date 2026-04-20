import { useState, useCallback, useEffect, useRef } from 'react'
import { ChevronRight, ChevronDown, RefreshCw, X } from 'lucide-react'

export interface InspectorNode {
  /** Display key (string or stringified non-string key) */
  key: string
  /** Lua type: table | function | string | number | boolean | userdata | nil | ellipsis */
  kind: string
  /** Short single-line preview */
  preview: string
}

export interface InspectorTreeReply {
  kind: string
  preview: string
  items: InspectorNode[]
}

export interface InspectorRequest {
  reqId: number
  /** "" or "_G" → root table */
  path: string
}

export interface InspectorBridge {
  /** Send a tree-inspect request and resolve with the parsed reply. */
  fetch(path: string): Promise<InspectorTreeReply>
}

/** Optional callbacks the host page wires into the inspector. */
export interface InspectorActions {
  /** Insert literal text into the Lua editor at the cursor (or append). */
  onInsertCode?: (code: string) => void
  /** Run a one-shot Lua expression (e.g. `print(dumps(x))`) and show in output. */
  onRunExpr?: (expr: string) => void
  /** Copy text to the system clipboard (with toast). */
  onCopy?: (text: string) => void
}

interface RowProps {
  path: string
  parentPath: string
  node: InspectorNode
  bridge: InspectorBridge
  depth: number
  actions: InspectorActions
}

function isExpandable(kind: string): boolean {
  return kind === 'table'
}

function joinPath(parent: string, key: string): string {
  if (!parent || parent === '_G') return key
  // Handle non-identifier keys with bracket access
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return parent + '.' + key
  return parent + '[' + JSON.stringify(key) + ']'
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'function': return 'text-amber-300'
    case 'table': return 'text-sky-300'
    case 'string': return 'text-emerald-300'
    case 'number': return 'text-fuchsia-300'
    case 'boolean': return 'text-purple-300'
    case 'userdata': return 'text-cyan-400'
    case 'nil': return 'text-[var(--color-text-muted)] italic'
    default: return 'text-[var(--color-text-secondary)]'
  }
}

function InspectorRow(p: RowProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [children, setChildren] = useState<InspectorNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const fullPath = joinPath(p.parentPath, p.node.key)

  const expand = useCallback(async () => {
    if (!isExpandable(p.node.kind)) return
    if (children) { setOpen(true); return }
    setLoading(true)
    setError(null)
    try {
      const reply = await p.bridge.fetch(fullPath)
      setChildren(reply.items)
      setOpen(true)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [children, fullPath, p.bridge, p.node.kind])

  const toggle = useCallback(() => {
    if (open) { setOpen(false); return }
    expand()
  }, [open, expand])

  const refresh = useCallback(async () => {
    if (!isExpandable(p.node.kind)) return
    setLoading(true)
    setError(null)
    try {
      const reply = await p.bridge.fetch(fullPath)
      setChildren(reply.items)
      setOpen(true)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [fullPath, p.bridge, p.node.kind])

  // Close context menu on outside click / Escape
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', close) }
  }, [menu])

  const onContext = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    p.actions.onInsertCode?.(fullPath)
  }

  const printExpr = `print(dumps(${fullPath}))`
  const callExpr = p.node.kind === 'function' ? `print(dumps(${fullPath}()))` : null

  return (
    <div>
      <div
        className="group flex items-center gap-1 px-1 py-0.5 hover:bg-[var(--color-surface-hover)] rounded cursor-pointer text-[12px] font-mono"
        style={{ paddingLeft: 4 + p.depth * 12 }}
        onClick={toggle}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContext}
        title={`${fullPath}\nDouble-click: insert into editor\nRight-click: actions`}
      >
        <span className="w-3 shrink-0 text-[var(--color-text-muted)]">
          {isExpandable(p.node.kind) ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : null}
        </span>
        <span className="text-[var(--color-text-primary)] shrink-0">{p.node.key}</span>
        <span className={`shrink-0 text-[10px] ${kindColor(p.node.kind)}`}>:{p.node.kind}</span>
        <span className="text-[var(--color-text-muted)] truncate">{p.node.preview}</span>
        {isExpandable(p.node.kind) && (
          <button
            onClick={(e) => { e.stopPropagation(); refresh() }}
            className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-accent-text-muted)]"
            title="Refresh"
          >
            <RefreshCw size={10} />
          </button>
        )}
      </div>
      {menu && (
        <div
          className="fixed z-50 min-w-[220px] rounded border border-[var(--color-border)] bg-[var(--color-scrim-40)] backdrop-blur-md shadow-2xl py-1 text-xs text-[var(--color-text-primary)]"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ContextItem label={`Insert "${fullPath}" into editor`}
            onClick={() => { p.actions.onInsertCode?.(fullPath); setMenu(null) }} />
          <ContextItem label="Print value (dumps)"
            onClick={() => { p.actions.onRunExpr?.(printExpr); setMenu(null) }} />
          {callExpr && (
            <ContextItem label="Call & print result"
              onClick={() => { p.actions.onRunExpr?.(callExpr); setMenu(null) }} />
          )}
          {isExpandable(p.node.kind) && (
            <ContextItem label="Expand / refresh"
              onClick={() => { refresh(); setMenu(null) }} />
          )}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <ContextItem label="Copy path"
            onClick={() => { p.actions.onCopy?.(fullPath); setMenu(null) }} />
          <ContextItem label="Copy preview"
            onClick={() => { p.actions.onCopy?.(p.node.preview); setMenu(null) }} />
        </div>
      )}
      {open && (
        <div>
          {loading && <div className="pl-6 py-0.5 text-[10px] text-[var(--color-text-muted)] italic">loading…</div>}
          {error && <div className="pl-6 py-0.5 text-[10px] text-red-400">{error}</div>}
          {children && children.length === 0 && (
            <div className="pl-6 py-0.5 text-[10px] text-[var(--color-text-muted)] italic">(empty)</div>
          )}
          {children && children.map((child) => (
            <InspectorRow
              key={child.key}
              parentPath={fullPath}
              path={joinPath(fullPath, child.key)}
              node={child}
              bridge={p.bridge}
              depth={p.depth + 1}
              actions={p.actions}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ContextItem(p: { label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={p.onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]"
    >
      {p.label}
    </button>
  )
}

interface PanelProps {
  bridge: InspectorBridge
  initialPath?: string
  onClose?: () => void
  actions?: InspectorActions
}

export function LuaConsoleInspector(p: PanelProps): React.JSX.Element {
  const actions: InspectorActions = p.actions ?? {}
  const [path, setPath] = useState(p.initialPath ?? '_G')
  const [pending, setPending] = useState(p.initialPath ?? '_G')
  const [reply, setReply] = useState<InspectorTreeReply | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastFetchRef = useRef<string>('')

  const load = useCallback(async (target: string) => {
    setLoading(true)
    setError(null)
    lastFetchRef.current = target
    try {
      const r = await p.bridge.fetch(target === '_G' ? '' : target)
      if (lastFetchRef.current === target) {
        setReply(r)
        setPath(target)
      }
    } catch (e) {
      if (lastFetchRef.current === target) setError(String((e as Error)?.message ?? e))
    } finally {
      if (lastFetchRef.current === target) setLoading(false)
    }
  }, [p.bridge])

  useEffect(() => { load(path) /* initial */ }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    load(pending.trim() || '_G')
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-scrim-10)] backdrop-blur-sm">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] backdrop-blur-sm">
        <form onSubmit={submit} className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            placeholder="path e.g. core_vehicles"
            className="flex-1 px-2 py-1 text-xs rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)] font-mono"
          />
          <button
            type="submit"
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-accent-text-muted)]"
            title="Inspect"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </form>
        {p.onClose && (
          <button
            onClick={p.onClose}
            className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            title="Close inspector"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto py-1">
        {error && <div className="px-3 py-2 text-xs text-red-400">{error}</div>}
        {!error && reply && (
          <>
            <div className="px-2 py-1 text-[10px] text-[var(--color-text-muted)] font-mono">
              {path} <span className={kindColor(reply.kind)}>:{reply.kind}</span>
            </div>
            {reply.items.length === 0
              ? <div className="px-3 py-2 text-xs italic text-[var(--color-text-muted)]">{reply.preview}</div>
              : reply.items.map((node) => (
                <InspectorRow
                  key={node.key}
                  parentPath={path === '_G' ? '' : path}
                  path={joinPath(path === '_G' ? '' : path, node.key)}
                  node={node}
                  bridge={p.bridge}
                  depth={0}
                  actions={actions}
                />
              ))}
          </>
        )}
      </div>
    </div>
  )
}
