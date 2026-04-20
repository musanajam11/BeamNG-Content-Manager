import { useEffect, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { LuaConsoleHeader, type VehicleEntry } from '../components/lua-console/LuaConsoleHeader'
import { LuaConsoleEditor, type CompletionItem } from '../components/lua-console/LuaConsoleEditor'
import { LuaConsoleOutput } from '../components/lua-console/LuaConsoleOutput'
import { LuaConsoleSidebar } from '../components/lua-console/LuaConsoleSidebar'
import { LuaConsoleSplitter } from '../components/lua-console/LuaConsoleSplitter'
import { LuaConsoleInspector, type InspectorTreeReply, type InspectorActions } from '../components/lua-console/LuaConsoleInspector'
import { LuaUIFilesPanel } from '../components/lua-console/LuaUIFilesPanel'
import {
  type LuaScope,
  type OutputEntry,
  type HistoryEntry,
  LUA_SNIPPETS,
  STORAGE_KEYS,
  loadJSON,
  saveJSON,
} from '../components/lua-console/luaConsoleShared'

/** Map from reqId → resolver for IPC requests that expect a JSON-encoded reply. */
type PendingResolvers = Map<number, (status: 'ok' | 'err', repr: string) => void>

export function LuaConsolePage(): React.JSX.Element {
  const { t } = useTranslation()
  const [deployed, setDeployed] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [scope, setScope] = useState<LuaScope>(() =>
    (loadJSON<LuaScope>(STORAGE_KEYS.scope, 'ge')) ?? 'ge'
  )
  const [vehId, setVehId] = useState<number | null>(null)
  const [vehicles, setVehicles] = useState<VehicleEntry[]>([])
  const [source, setSource] = useState<string>(() =>
    loadJSON<string>(STORAGE_KEYS.draft, '') ?? ''
  )
  const [output, setOutput] = useState<OutputEntry[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>(() =>
    loadJSON<HistoryEntry[]>(STORAGE_KEYS.history, []) ?? []
  )
  const [filter, setFilter] = useState<'all' | 'log' | 'print' | 'result' | 'err'>('all')
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [wordWrap, setWordWrap] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<'history' | 'snippets'>('history')
  const [editorHeight, setEditorHeight] = useState<number>(() =>
    loadJSON<number>(STORAGE_KEYS.editorHeight, 200) ?? 200
  )
  const [outputCollapsed, setOutputCollapsed] = useState<boolean>(() =>
    loadJSON<boolean>(STORAGE_KEYS.outputCollapsed, false) ?? false
  )
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    loadJSON<boolean>(STORAGE_KEYS.inspectorOpen, false) ?? false
  )
  const [inspectorWidth, setInspectorWidth] = useState<number>(() =>
    loadJSON<number>(STORAGE_KEYS.inspectorWidth, 360) ?? 360
  )
  const [tabMode, setTabMode] = useState<'code' | 'ui' | 'split'>(() =>
    (loadJSON<'code' | 'ui' | 'split'>(STORAGE_KEYS.tabMode, 'split') ?? 'split')
  )
  const [luaSplitPct, setLuaSplitPct] = useState<number>(() =>
    loadJSON<number>(STORAGE_KEYS.luaSplitPct, 50) ?? 50
  )
  const [historyCursor, setHistoryCursor] = useState<number>(-1)

  const splitContainerRef = useRef<HTMLDivElement | null>(null)
  const hSplitContainerRef = useRef<HTMLDivElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const reqIdRef = useRef(1)
  /** Pending REPL queries (Execute / Inspect) — resolved by R| frame for output rendering. */
  const pendingRef = useRef<Map<number, string>>(new Map())
  /** Pending IPC requests that expect a JSON-decoded reply (complete/tree/query/reload). */
  const promisedRef = useRef<PendingResolvers>(new Map())

  // Persist drafts/history/scope/layout
  useEffect(() => { saveJSON(STORAGE_KEYS.draft, source) }, [source])
  useEffect(() => { saveJSON(STORAGE_KEYS.history, history.slice(0, 200)) }, [history])
  useEffect(() => { saveJSON(STORAGE_KEYS.scope, scope) }, [scope])
  useEffect(() => { saveJSON(STORAGE_KEYS.editorHeight, editorHeight) }, [editorHeight])
  useEffect(() => { saveJSON(STORAGE_KEYS.outputCollapsed, outputCollapsed) }, [outputCollapsed])
  useEffect(() => { saveJSON(STORAGE_KEYS.inspectorOpen, inspectorOpen) }, [inspectorOpen])
  useEffect(() => { saveJSON(STORAGE_KEYS.inspectorWidth, inspectorWidth) }, [inspectorWidth])
  useEffect(() => { saveJSON(STORAGE_KEYS.tabMode, tabMode) }, [tabMode])
  useEffect(() => { saveJSON(STORAGE_KEYS.luaSplitPct, luaSplitPct) }, [luaSplitPct])

  // Drag handle for the vertical split between Lua console and UI Files panel.
  const handleVerticalSplitDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const container = hSplitContainerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (ev: MouseEvent): void => {
      const x = ev.clientX - rect.left
      const pct = (x / rect.width) * 100
      setLuaSplitPct(Math.min(85, Math.max(15, pct)))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Drag handle for the inspector panel left edge — resizes width.
  const handleInspectorDrag = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = inspectorWidth
    const root = rootRef.current
    const onMove = (ev: MouseEvent) => {
      const max = root ? Math.max(220, root.clientWidth - 480) : 900
      const next = Math.min(max, Math.max(220, startW + (startX - ev.clientX)))
      setInspectorWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [inspectorWidth])

  // Clamp editor height so the output area always has >= 120px.
  useEffect(() => {
    const container = splitContainerRef.current
    if (!container) return
    const clamp = (): void => {
      const h = container.clientHeight
      if (h <= 0) return
      const maxEditor = Math.max(120, h - 120)
      setEditorHeight((cur) => {
        const target = Math.min(maxEditor, Math.max(120, cur))
        return target === cur ? cur : target
      })
    }
    clamp()
    const ro = new ResizeObserver(clamp)
    ro.observe(container)
    return () => ro.disconnect()
  }, [])

  const handleSplitterResize = useCallback((dy: number) => {
    setEditorHeight((cur) => {
      const container = splitContainerRef.current
      const max = container ? Math.max(120, container.clientHeight - 120) : 800
      return Math.min(max, Math.max(120, cur + dy))
    })
  }, [])

  const handleResetOutput = useCallback(() => {
    setEditorHeight(200)
    setOutputCollapsed(false)
  }, [])

  // Initial deploy/connect probe
  useEffect(() => {
    let alive = true
    Promise.all([
      window.api.luaConsoleIsDeployed(),
      window.api.luaConsoleIsConnected(),
    ]).then(([d, c]) => {
      if (!alive) return
      setDeployed(d)
      setConnected(c)
    }).catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [])

  // R| / L| / connection events. Routes JSON-promised replies (complete/tree/query/reload)
  // to their resolver instead of the output panel.
  useEffect(() => {
    const offResult = window.api.onLuaConsoleResult((data) => {
      const resolver = promisedRef.current.get(data.reqId)
      if (resolver) {
        promisedRef.current.delete(data.reqId)
        resolver(data.status, data.repr)
        return
      }
      const src = pendingRef.current.get(data.reqId) ?? ''
      pendingRef.current.delete(data.reqId)
      setOutput((prev) => [
        ...prev,
        {
          id: `${data.reqId}-r`,
          at: Date.now(),
          kind: data.status === 'ok' ? 'result' : 'err',
          source: src,
          text: data.repr,
          scope,
        },
      ])
      setBusy(false)
    })
    const offLog = window.api.onLuaConsoleLog((data) => {
      setOutput((prev) => [
        ...prev,
        {
          id: `${data.at}-${Math.random().toString(36).slice(2, 7)}`,
          at: data.at,
          kind: data.kind,
          level: data.level,
          source: data.source,
          text: data.text,
          scope,
        },
      ])
    })
    const offConn = window.api.onLuaConsoleConnection((d) => setConnected(d.connected))
    return () => { offResult(); offLog(); offConn() }
  }, [scope])

  /**
   * Issue an IPC call that expects a single R| reply, and resolve a Promise
   * with the parsed JSON payload (or reject on err / timeout). Used for
   * complete/tree/query/reload — anything that should NOT show up in the
   * output panel.
   */
  const promisedRequest = useCallback(<T,>(
    invoke: (reqId: number) => Promise<unknown>,
    timeoutMs = 5000,
  ): Promise<T> => {
    const reqId = reqIdRef.current++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        promisedRef.current.delete(reqId)
        reject(new Error('lua console request timed out'))
      }, timeoutMs)
      promisedRef.current.set(reqId, (status, repr) => {
        clearTimeout(timer)
        if (status === 'err') {
          let msg = repr
          try {
            const parsed = repr ? JSON.parse(repr) : repr
            if (typeof parsed === 'string') msg = parsed
          } catch { /* keep raw */ }
          reject(new Error(msg))
          return
        }
        try {
          resolve(repr ? JSON.parse(repr) as T : (null as unknown as T))
        } catch (e) {
          reject(e as Error)
        }
      })
      invoke(reqId).catch((e) => {
        clearTimeout(timer)
        promisedRef.current.delete(reqId)
        reject(e as Error)
      })
    })
  }, [])

  const refreshVehicles = useCallback(async () => {
    if (!connected) return
    try {
      const list = await promisedRequest<VehicleEntry[]>((reqId) =>
        window.api.luaConsoleQuery({ reqId, query: 'vehicles' }),
      )
      setVehicles(Array.isArray(list) ? list : [])
    } catch { /* ignore — vehicles will stay empty */ }
  }, [connected, promisedRequest])

  // Auto-refresh vehicle list when scope changes to 'veh' or on connect.
  useEffect(() => {
    if (scope === 'veh' && connected) refreshVehicles()
  }, [scope, connected, refreshVehicles])

  const handleDeploy = useCallback(async () => {
    setBusy(true)
    try {
      const res = await window.api.luaConsoleDeploy()
      if (res.success) {
        setDeployed(true)
        setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: t('luaConsole.deployed', { port: res.port }), scope }])
      } else {
        setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'err', text: res.error ?? 'deploy failed', scope }])
      }
    } finally { setBusy(false) }
  }, [scope, t])

  const handleUndeploy = useCallback(async () => {
    setBusy(true)
    try {
      await window.api.luaConsoleUndeploy()
      setDeployed(false)
      setConnected(false)
      setVehicles([])
      setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: t('luaConsole.undeployed'), scope }])
    } finally { setBusy(false) }
  }, [scope, t])

  const handleScopeChange = useCallback(async (s: LuaScope) => {
    setScope(s)
    try { await window.api.luaConsoleSetScope({ scope: s, vehId }) } catch { /* ignore */ }
  }, [vehId])

  const handleVehicleChange = useCallback(async (id: number | null) => {
    setVehId(id)
    try { await window.api.luaConsoleSetScope({ scope, vehId: id }) } catch { /* ignore */ }
  }, [scope])

  const runSource = useCallback(async (src: string) => {
    const trimmed = src.trim()
    if (!trimmed) return
    const reqId = reqIdRef.current++
    pendingRef.current.set(reqId, trimmed)
    setBusy(true)
    setHistoryCursor(-1)
    setHistory((prev) => {
      const next: HistoryEntry[] = [
        { id: `h-${Date.now()}`, at: Date.now(), source: trimmed, scope },
        ...prev.filter((h) => h.source !== trimmed),
      ]
      return next.slice(0, 200)
    })
    setOutput((p) => [...p, { id: `${reqId}-q`, at: Date.now(), kind: 'query', source: trimmed, text: trimmed, scope }])
    try {
      await window.api.luaConsoleExecute({ reqId, source: trimmed })
    } catch (e) {
      pendingRef.current.delete(reqId)
      setBusy(false)
      setOutput((p) => [...p, { id: `${reqId}-e`, at: Date.now(), kind: 'err', text: String((e as Error)?.message ?? e), scope }])
    }
  }, [scope])

  const handleRun = useCallback(() => { runSource(source) }, [runSource, source])

  const handleInspect = useCallback(async (path: string) => {
    const trimmed = path.trim()
    if (!trimmed) return
    const reqId = reqIdRef.current++
    pendingRef.current.set(reqId, `inspect ${trimmed}`)
    setBusy(true)
    setOutput((p) => [...p, { id: `${reqId}-i`, at: Date.now(), kind: 'query', source: `:inspect ${trimmed}`, text: `:inspect ${trimmed}`, scope }])
    try {
      await window.api.luaConsoleInspect({ reqId, path: trimmed })
    } catch (e) {
      pendingRef.current.delete(reqId)
      setBusy(false)
      setOutput((p) => [...p, { id: `${reqId}-e`, at: Date.now(), kind: 'err', text: String((e as Error)?.message ?? e), scope }])
    }
  }, [scope])

  const handleReload = useCallback(async (action: 'ge' | 'veh' | 'env') => {
    try {
      await promisedRequest<string>((reqId) => window.api.luaConsoleReload({ reqId, action }))
      setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: `reload ${action}: requested`, scope }])
    } catch (e) {
      setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'err', text: `reload ${action}: ${(e as Error).message}`, scope }])
    }
  }, [promisedRequest, scope])

  const handleClearOutput = useCallback(() => { setOutput([]) }, [])
  const handleClearRemote = useCallback(async () => {
    try { await window.api.luaConsoleClear() } catch { /* ignore */ }
    setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: t('luaConsole.remoteCleared'), scope }])
  }, [scope, t])

  const handleHistoryReplay = useCallback((src: string) => { setSource(src) }, [])
  const handleHistoryRun = useCallback((src: string) => { runSource(src) }, [runSource])
  const handleSnippetInsert = useCallback((code: string) => {
    setSource((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')}\n\n${code}` : code))
  }, [])
  const inspectorActions: InspectorActions = {
    onInsertCode: (code) => handleSnippetInsert(code),
    onRunExpr: (expr) => runSource(expr),
    onCopy: (text) => {
      navigator.clipboard?.writeText(text).catch(() => { /* ignore */ })
      setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: `Copied: ${text}`, scope }])
    },
  }
  const handleClearHistory = useCallback(() => { setHistory([]) }, [])

  // Up-arrow recall from editor: cycles through history (newest first).
  const handleHistoryPrev = useCallback((): string | null => {
    if (history.length === 0) return null
    const next = Math.min(history.length - 1, historyCursor + 1)
    setHistoryCursor(next)
    return history[next]?.source ?? null
  }, [history, historyCursor])
  const handleHistoryNext = useCallback((): string | null => {
    if (historyCursor <= 0) {
      setHistoryCursor(-1)
      return ''
    }
    const next = historyCursor - 1
    setHistoryCursor(next)
    return history[next]?.source ?? null
  }, [history, historyCursor])

  // Live tab-completion bridge for the Monaco provider.
  const handleComplete = useCallback(async (prefix: string): Promise<CompletionItem[]> => {
    if (!connected) return []
    try {
      const items = await promisedRequest<CompletionItem[]>((reqId) =>
        window.api.luaConsoleComplete({ reqId, prefix }),
        1500,
      )
      return Array.isArray(items) ? items : []
    } catch { return [] }
  }, [connected, promisedRequest])

  // Inspector bridge — fetches one tree level for the inspector panel.
  const inspectorBridge = {
    fetch: async (path: string): Promise<InspectorTreeReply> => {
      return promisedRequest<InspectorTreeReply>((reqId) =>
        window.api.luaConsoleTree({ reqId, path }),
        4000,
      )
    },
  }

  // Source-link click: opens the file in the system editor (best effort).
  const handleSourceLink = useCallback((file: string, line: number): void => {
    setOutput((p) => [...p, { id: `sys-${Date.now()}`, at: Date.now(), kind: 'system', text: `(open ${file}:${line} \u2014 use your editor's "Open File" feature)`, scope }])
  }, [scope])

  return (
    <div ref={rootRef} className="h-full flex flex-col min-h-0 bg-[var(--color-scrim-10)] backdrop-blur-sm">
      <LuaConsoleHeader
        deployed={deployed}
        connected={connected}
        busy={busy}
        scope={scope}
        vehId={vehId}
        vehicles={vehicles}
        onRefreshVehicles={refreshVehicles}
        onScopeChange={handleScopeChange}
        onVehicleChange={handleVehicleChange}
        onDeploy={handleDeploy}
        onUndeploy={handleUndeploy}
        onRun={handleRun}
        onClearOutput={handleClearOutput}
        onClearRemote={handleClearRemote}
        onReload={handleReload}
        onToggleInspector={() => setInspectorOpen((v) => !v)}
        inspectorOpen={inspectorOpen}
        wordWrap={wordWrap}
        onToggleWordWrap={() => setWordWrap((v) => !v)}
        autoScroll={autoScroll}
        onToggleAutoScroll={() => setAutoScroll((v) => !v)}
        tabMode={tabMode}
        onTabModeChange={setTabMode}
      />
      <div className="flex-1 flex min-h-0">
        <LuaConsoleSidebar
          tab={sidebarTab}
          onTabChange={setSidebarTab}
          history={history}
          snippets={LUA_SNIPPETS}
          onReplay={handleHistoryReplay}
          onRunHistory={handleHistoryRun}
          onInsertSnippet={handleSnippetInsert}
          onClearHistory={handleClearHistory}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="flex-1 flex min-h-0 min-w-0" ref={hSplitContainerRef}>
            {tabMode !== 'ui' && (
              <div
                className={`${tabMode === 'split' ? 'min-w-0 shrink-0' : 'flex-1 min-w-0'} flex flex-col min-h-0`}
                style={tabMode === 'split' ? { width: `${luaSplitPct}%` } : undefined}
              >
                <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] backdrop-blur-sm">
                  Lua Console
                </div>
                <div className="flex-1 flex flex-col min-h-0" ref={splitContainerRef}>
                  <div
                    className="shrink-0 border-b border-[var(--color-border)] overflow-hidden"
                    style={{ height: editorHeight }}
                  >
                    <LuaConsoleEditor
                      value={source}
                      onChange={setSource}
                      onRun={handleRun}
                      onInspect={handleInspect}
                      onComplete={handleComplete}
                      onHistoryPrev={handleHistoryPrev}
                      onHistoryNext={handleHistoryNext}
                      wordWrap={wordWrap}
                    />
                  </div>
                  <LuaConsoleSplitter
                    onResize={handleSplitterResize}
                    outputCollapsed={outputCollapsed}
                    onCollapseOutput={() => setOutputCollapsed(true)}
                    onExpandOutput={() => setOutputCollapsed(false)}
                    onResetOutput={handleResetOutput}
                  />
                  {!outputCollapsed && (
                    <div className="flex-1 min-h-0 flex flex-col">
                      <LuaConsoleOutput
                        entries={output}
                        filter={filter}
                        onFilterChange={setFilter}
                        search={search}
                        onSearchChange={setSearch}
                        autoScroll={autoScroll}
                        wordWrap={wordWrap}
                        onSourceLink={handleSourceLink}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
            {tabMode === 'split' && (
              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleVerticalSplitDrag}
                onDoubleClick={() => setLuaSplitPct(50)}
                className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                title="Drag to resize · Double-click to reset"
              />
            )}
            {tabMode !== 'code' && (
              <div className="flex-1 min-w-0 flex flex-col min-h-0">
                <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] px-3 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)] backdrop-blur-sm">
                  Dev Editor
                </div>
                <div className="flex-1 min-h-0">
                  <LuaUIFilesPanel onReloadUI={() => runSource('be:reloadUI()')} />
                </div>
              </div>
            )}
          </div>
        </div>
        {inspectorOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleInspectorDrag}
              className="w-1 shrink-0 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
              title="Drag to resize inspector"
            />
            <div
              className="shrink-0 border-l border-[var(--color-border)] flex flex-col min-h-0"
              style={{ width: inspectorWidth }}
            >
              <LuaConsoleInspector
                bridge={inspectorBridge}
                onClose={() => setInspectorOpen(false)}
                actions={inspectorActions}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
