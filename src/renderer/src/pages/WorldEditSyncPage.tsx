import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Globe2,
  Power,
  PowerOff,
  Loader2,
  Play,
  Square,
  RefreshCw,
  Plug,
  Unplug,
  Trash2,
  Undo2,
  Redo2,
  Save,
  SaveAll,
  FolderOpen,
  FolderPlus,
} from 'lucide-react'
import type {
  EditorSyncStatus,
  EditorSyncCaptureEntry,
  EditorProject,
} from '../../../shared/types'
import { WorldEditSessionPage } from './WorldEditSessionPage'

/**
 * World Editor Sync — Phase 0 spike UI.
 *
 * Surfaces the capture/replay controls for the beamcmEditorSync.lua
 * extension. Reads status (500 ms via `worldEditGetStatus`) and tails the
 * `we_capture.log` (1 s) so the user can verify the hooks are firing
 * without needing DevTools.
 *
 * This intentionally does NOT build a full session / transport UI. That
 * lands in Phase 1+ per Project/Docs/WORLD-EDITOR-SYNC.md.
 */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'good' | 'warn' | 'bad' | 'neutral'
}): React.JSX.Element {
  const toneClass =
    tone === 'good'
      ? 'bg-green-500/15 text-green-400 border-green-500/30'
      : tone === 'warn'
        ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
        : tone === 'bad'
          ? 'bg-red-500/15 text-red-400 border-red-500/30'
          : 'bg-[var(--color-surface)] text-[var(--color-text-muted)] border-[var(--color-border)]'
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${toneClass}`}>
      <span className="text-xs uppercase tracking-wide opacity-80">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  )
}

export function WorldEditSyncPage(): React.JSX.Element {
  const [deployed, setDeployed] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [signalBusy, setSignalBusy] = useState(false)
  const [status, setStatus] = useState<EditorSyncStatus | null>(null)
  const [capture, setCapture] = useState<{ entries: EditorSyncCaptureEntry[]; total: number }>({
    entries: [],
    total: 0,
  })
  const [projects, setProjects] = useState<EditorProject[]>([])
  const [projectsBusy, setProjectsBusy] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [tab, setTab] = useState<'bridge' | 'session'>('bridge')
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const autoscrollRef = useRef(true)

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    setTimeout(() => setFlash((prev) => (prev === msg ? null : prev)), 2500)
  }, [])

  // Check initial deploy state + poll status while deployed
  useEffect(() => {
    ;(async () => {
      try {
        const isDeployed = await window.api.worldEditIsDeployed()
        setDeployed(isDeployed)
      } catch {
        /* ignore */
      }
    })()
  }, [])

  // Re-check deploy state whenever the game process stops, since the
  // launcher auto-undeploys every CM extension on game exit.
  useEffect(() => {
    const unsub = window.api.onGameStatusChange(async (status) => {
      if (!status.running) {
        try {
          const isDeployed = await window.api.worldEditIsDeployed()
          setDeployed(isDeployed)
          if (!isDeployed) showFlash('Extension was auto-undeployed when BeamNG exited')
        } catch { /* ignore */ }
      }
    })
    return () => { unsub() }
  }, [showFlash])

  useEffect(() => {
    if (!deployed) {
      setStatus(null)
      return
    }
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const s = await window.api.worldEditGetStatus()
        if (!cancelled) setStatus(s)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = setInterval(tick, 500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [deployed])

  // Tail the capture log while deployed
  useEffect(() => {
    if (!deployed) {
      setCapture({ entries: [], total: 0 })
      return
    }
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const c = await window.api.worldEditReadCapture(200)
        if (!cancelled) setCapture(c)
      } catch {
        /* ignore */
      }
    }
    void tick()
    const id = setInterval(tick, 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [deployed])

  // Autoscroll capture log
  useEffect(() => {
    if (autoscrollRef.current) {
      logEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [capture.entries.length])

  const handleDeploy = useCallback(async () => {
    setDeploying(true)
    setLastError(null)
    try {
      const res = deployed
        ? await window.api.worldEditUndeploy()
        : await window.api.worldEditDeploy()
      if (!res.success) {
        setLastError(res.error ?? 'Unknown error')
      } else {
        setDeployed(!deployed)
        showFlash(deployed ? 'Extension undeployed' : 'Extension deployed — open the world editor (F11) in BeamNG')
      }
    } catch (err) {
      setLastError(String(err))
    } finally {
      setDeploying(false)
    }
  }, [deployed, showFlash])

  const sendSignal = useCallback(
    async (
      action:
        | 'start'
        | 'stop'
        | 'replay'
        | 'install'
        | 'uninstall'
        | 'undo'
        | 'redo'
        | 'save'
        | 'saveAs'
        | 'saveProject'
        | 'loadProject',
      label: string,
      payload?: { path?: string }
    ) => {
      setSignalBusy(true)
      setLastError(null)
      try {
        const res = await window.api.worldEditSignal(action, payload)
        if (!res.success) {
          setLastError(res.error ?? 'Unknown error')
        } else {
          showFlash(label)
        }
      } catch (err) {
        setLastError(String(err))
      } finally {
        setSignalBusy(false)
      }
    },
    [showFlash]
  )

  const handleSaveAs = useCallback(() => {
    const raw = window.prompt(
      'Save map as (level path):\n\n' +
        'Use BeamNG path format, e.g. "/levels/my_custom_map/".\n' +
        'The target directory will be created under the game userDir.',
      '/levels/my_custom_map/'
    )
    if (!raw) return
    let p = raw.trim()
    if (!p) return
    // Normalise: ensure leading slash and trailing slash
    if (!p.startsWith('/')) p = '/' + p
    if (!p.endsWith('/')) p = p + '/'
    sendSignal('saveAs', `Save As → ${p}`, { path: p })
  }, [sendSignal])

  const refreshProjects = useCallback(async () => {
    try {
      const list = await window.api.worldEditListProjects()
      setProjects(list)
    } catch {
      /* ignore */
    }
  }, [])

  const handleSaveAsProject = useCallback(async () => {
    const levelName = status?.levelName
    if (!levelName) {
      setLastError('No level loaded — cannot save project')
      return
    }
    const raw = window.prompt(
      `Save current editor state as a project of "${levelName}".\n\n` +
        'Enter a project name (letters, digits, dot, dash, underscore; max 48 chars):',
      'my_project'
    )
    if (!raw) return
    const name = raw.trim()
    if (!name) return
    setProjectsBusy(true)
    setLastError(null)
    try {
      const res = await window.api.worldEditSaveProject(levelName, name)
      if (!res.success) {
        setLastError(res.error ?? 'Unknown error')
      } else {
        showFlash(`Project saved: ${name}`)
        void refreshProjects()
      }
    } catch (err) {
      setLastError(String(err))
    } finally {
      setProjectsBusy(false)
    }
  }, [status?.levelName, showFlash, refreshProjects])

  const handleLoadProject = useCallback(
    async (p: EditorProject) => {
      if (
        !window.confirm(
          `Load project "${p.name}" (${p.levelName})?\n\n` +
            'BeamNG will reload the level. Any unsaved edits in the current session will be lost.'
        )
      )
        return
      setProjectsBusy(true)
      setLastError(null)
      try {
        const res = await window.api.worldEditLoadProject(p.levelPath)
        if (!res.success) setLastError(res.error ?? 'Unknown error')
        else showFlash(`Loading project: ${p.name}`)
      } catch (err) {
        setLastError(String(err))
      } finally {
        setProjectsBusy(false)
      }
    },
    [showFlash]
  )

  const handleDeleteProject = useCallback(
    async (p: EditorProject) => {
      if (!window.confirm(`Delete project "${p.name}" (${p.levelName})?\n\nThis cannot be undone.`))
        return
      setProjectsBusy(true)
      setLastError(null)
      try {
        const res = await window.api.worldEditDeleteProject(p.path)
        if (!res.success) setLastError(res.error ?? 'Unknown error')
        else {
          showFlash(`Deleted: ${p.name}`)
          void refreshProjects()
        }
      } catch (err) {
        setLastError(String(err))
      } finally {
        setProjectsBusy(false)
      }
    },
    [showFlash, refreshProjects]
  )

  // Refresh project list on mount and whenever deployment state changes
  useEffect(() => {
    void refreshProjects()
  }, [refreshProjects, deployed])

  const capturing = status?.capturing === true
  const hooked = status?.hooked === true
  const editorPresent = status?.editorPresent === true
  const replayActive = status?.replayActive === true

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-center gap-3">
          <Globe2 size={24} className="text-orange-400" />
          <div>
            <h1 className="text-xl font-semibold leading-tight">Coop World Editor</h1>
            <p className="text-xs text-[var(--color-text-muted)]">
              Collaborative BeamNG world editor sessions — peer-to-peer over TCP, no BeamMP server needed
            </p>
          </div>
        </div>
        <button
          onClick={handleDeploy}
          disabled={deploying}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border disabled:opacity-50 ${
            deployed
              ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border-red-500/30'
              : 'bg-green-500/20 text-green-400 hover:bg-green-500/30 border-green-500/30'
          }`}
        >
          {deploying ? (
            <Loader2 size={16} className="animate-spin" />
          ) : deployed ? (
            <PowerOff size={16} />
          ) : (
            <Power size={16} />
          )}
          {deployed ? 'Undeploy extension' : 'Deploy extension'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-3 border-b border-[var(--color-border)]">
        <button
          onClick={() => setTab('bridge')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'bridge'
              ? 'border-[var(--color-accent)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Bridge &amp; capture
        </button>
        <button
          onClick={() => setTab('session')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'session'
              ? 'border-[var(--color-accent)] text-[var(--color-text)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
          }`}
        >
          Multiplayer session
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {tab === 'session' ? (
          <WorldEditSessionPage />
        ) : (
          <>
        {/* Flash / error banners */}
        {flash && (
          <div className="px-4 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm">
            {flash}
          </div>
        )}
        {lastError && (
          <div className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            Error: {lastError}
          </div>
        )}

        {/* Guidance */}
        {!deployed && (
          <div className="px-4 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] space-y-1">
            <p>
              Click <span className="font-medium text-[var(--color-text)]">Deploy extension</span> to install
              <code className="mx-1 px-1 py-0.5 rounded bg-black/30 text-xs">beamcmEditorSync.lua</code>
              into your BeamNG userDir and hot-load it.
            </p>
            <p>
              BeamNG must already be running via the BeamCM launcher so the bridge is active.
            </p>
          </div>
        )}

        {deployed && !hooked && !editorPresent && (
          <div className="px-4 py-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
            Extension deployed. Open the BeamNG world editor (press <kbd>F11</kbd> in-game) to install hooks.
          </div>
        )}

        {/* Status pills */}
        {deployed && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatusPill
              label="Editor"
              value={editorPresent ? 'Present' : 'Not active'}
              tone={editorPresent ? 'good' : 'warn'}
            />
            <StatusPill
              label="Hooks"
              value={hooked ? 'Installed' : 'Not installed'}
              tone={hooked ? 'good' : 'warn'}
            />
            <StatusPill
              label="Capturing"
              value={capturing ? 'Yes' : 'No'}
              tone={capturing ? 'good' : 'neutral'}
            />
            <StatusPill
              label="Captured actions"
              value={String(status?.captureCount ?? 0)}
              tone="neutral"
            />
            {replayActive && (
              <StatusPill
                label="Replay"
                value={`${status?.replayIndex ?? 0} / ${status?.replayTotal ?? 0}`}
                tone="warn"
              />
            )}
          </div>
        )}

        {/* Controls */}
        {deployed && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              Controls
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => sendSignal('start', 'Capture started')}
                disabled={signalBusy || capturing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-green-500/30 bg-green-500/15 text-green-400 hover:bg-green-500/25 text-sm disabled:opacity-40"
              >
                <Play size={16} /> Start capture
              </button>
              <button
                onClick={() => sendSignal('stop', 'Capture stopped')}
                disabled={signalBusy || !capturing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-500/30 bg-red-500/15 text-red-400 hover:bg-red-500/25 text-sm disabled:opacity-40"
              >
                <Square size={16} /> Stop capture
              </button>
              <button
                onClick={() => sendSignal('replay', 'Replay started')}
                disabled={signalBusy || capturing || replayActive || capture.total === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-500/30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 text-sm disabled:opacity-40"
              >
                <RefreshCw size={16} /> Replay log
              </button>
              <div className="w-px bg-[var(--color-border)] mx-1" />
              <button
                onClick={() => sendSignal('undo', 'Undo sent')}
                disabled={signalBusy || !hooked}
                title="Ctrl+Z in the BeamNG editor"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-sm disabled:opacity-40"
              >
                <Undo2 size={14} /> Undo
              </button>
              <button
                onClick={() => sendSignal('redo', 'Redo sent')}
                disabled={signalBusy || !hooked}
                title="Ctrl+Y in the BeamNG editor"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-sm disabled:opacity-40"
              >
                <Redo2 size={14} /> Redo
              </button>
              <button
                onClick={() => sendSignal('save', 'Save map sent')}
                disabled={signalBusy || !editorPresent}
                title="Overwrites the current level (editor.doSaveLevel — same as Ctrl+S in-editor)"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 text-sm disabled:opacity-40"
              >
                <Save size={14} /> Save map
              </button>
              <button
                onClick={handleSaveAs}
                disabled={signalBusy || !editorPresent}
                title="Save to a new level path (editor.saveLevelAs) — does NOT overwrite the original"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 text-sm disabled:opacity-40"
              >
                <SaveAll size={14} /> Save as…
              </button>
              <button
                onClick={handleSaveAsProject}
                disabled={projectsBusy || signalBusy || !editorPresent || !status?.levelName}
                title="Snapshot the current editor state as a named project you can reload later"
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25 text-sm disabled:opacity-40"
              >
                <FolderPlus size={14} /> Save as project…
              </button>
              <div className="w-px bg-[var(--color-border)] mx-1" />
              <button
                onClick={() => sendSignal('install', 'Install hooks signalled')}
                disabled={signalBusy || hooked}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-sm disabled:opacity-40"
              >
                <Plug size={14} /> Install hooks
              </button>
              <button
                onClick={() => sendSignal('uninstall', 'Uninstall hooks signalled')}
                disabled={signalBusy || !hooked}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-sm disabled:opacity-40"
              >
                <Unplug size={14} /> Uninstall hooks
              </button>
            </div>
          </div>
        )}

        {/* Capture log preview */}
        {deployed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Capture log
              </h2>
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <span>{capture.total} total lines</span>
                <label className="flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    defaultChecked
                    onChange={(e) => {
                      autoscrollRef.current = e.target.checked
                    }}
                  />
                  autoscroll
                </label>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-black/40 font-mono text-xs overflow-auto max-h-[50vh]">
              {capture.entries.length === 0 ? (
                <div className="px-3 py-6 text-center text-[var(--color-text-muted)]">
                  No captured actions yet. Start capture and perform edits in BeamNG.
                </div>
              ) : (
                <table className="w-full">
                  <thead className="sticky top-0 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                    <tr>
                      <th className="text-left px-3 py-1.5 w-16">#</th>
                      <th className="text-left px-3 py-1.5 w-16">t+ms</th>
                      <th className="text-left px-3 py-1.5 w-20">kind</th>
                      <th className="text-left px-3 py-1.5 w-48">name</th>
                      <th className="text-left px-3 py-1.5">detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capture.entries.map((e, i) => (
                      <tr
                        key={`${e.seq}-${i}`}
                        className="border-b border-[var(--color-border)]/40 last:border-b-0"
                      >
                        <td className="px-3 py-1 tabular-nums text-[var(--color-text-muted)]">
                          {e.seq}
                        </td>
                        <td className="px-3 py-1 tabular-nums text-[var(--color-text-muted)]">
                          {e.ts}
                        </td>
                        <td className="px-3 py-1">
                          <span
                            className={
                              e.kind === 'do'
                                ? 'text-green-400'
                                : e.kind === 'undo'
                                  ? 'text-yellow-400'
                                  : e.kind === 'redo'
                                    ? 'text-blue-400'
                                    : e.kind === 'tx-begin'
                                      ? 'text-fuchsia-400'
                                      : e.kind === 'tx-end'
                                        ? 'text-fuchsia-300/70'
                                        : 'text-[var(--color-text-muted)]'
                            }
                          >
                            {e.kind}
                          </span>
                        </td>
                        <td className="px-3 py-1 truncate">{e.name ?? ''}</td>
                        <td
                          className="px-3 py-1 truncate text-[var(--color-text-muted)]"
                          title={e.detail ?? ''}
                        >
                          {e.detail ?? ''}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={5}>
                        <div ref={logEndRef} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
            {capture.total > capture.entries.length && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Showing last {capture.entries.length} of {capture.total} lines.
              </p>
            )}
          </div>
        )}

        {/* Project browser */}
        {deployed && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                Projects
              </h2>
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-muted)]">
                <span>{projects.length} saved</span>
                <button
                  onClick={() => void refreshProjects()}
                  disabled={projectsBusy}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
                >
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              {projects.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-[var(--color-text-muted)]">
                  No projects yet. In the BeamNG editor, click <strong>Save as project…</strong> above to
                  snapshot the current level.
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-black/20 text-[var(--color-text-muted)]">
                    <tr>
                      <th className="text-left px-3 py-1.5">Name</th>
                      <th className="text-left px-3 py-1.5">Level</th>
                      <th className="text-left px-3 py-1.5 w-40">Modified</th>
                      <th className="text-right px-3 py-1.5 w-24">Size</th>
                      <th className="px-3 py-1.5 w-48"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr
                        key={p.path}
                        className="border-t border-[var(--color-border)]/40"
                      >
                        <td className="px-3 py-1.5 font-medium">{p.name}</td>
                        <td className="px-3 py-1.5 text-[var(--color-text-muted)]">{p.levelName}</td>
                        <td className="px-3 py-1.5 text-[var(--color-text-muted)] tabular-nums">
                          {new Date(p.mtime).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right text-[var(--color-text-muted)] tabular-nums">
                          {formatBytes(p.sizeBytes)}
                        </td>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => void handleLoadProject(p)}
                              disabled={projectsBusy || !editorPresent}
                              title="Reload BeamNG into this project (full level reload)"
                              className="flex items-center gap-1 px-2 py-1 rounded border border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300 hover:bg-fuchsia-500/20 disabled:opacity-40"
                            >
                              <FolderOpen size={12} /> Load
                            </button>
                            <button
                              onClick={() => void handleDeleteProject(p)}
                              disabled={projectsBusy}
                              title="Delete this project folder"
                              className="flex items-center gap-1 px-2 py-1 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                            >
                              <Trash2 size={12} /> Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* Tips */}
        {deployed && (
          <div className="px-4 py-3 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-xs text-[var(--color-text-muted)] space-y-1">
            <p className="flex items-center gap-2">
              <Trash2 size={12} /> Undeploying leaves <code>we_capture.log</code> on disk so you can
              inspect it afterwards.
            </p>
            <p>
              If status shows <em>Editor: Not active</em>, open the BeamNG world editor with{' '}
              <kbd>F11</kbd>. Hooks auto-install the first time the editor activates.
            </p>
          </div>
        )}
          </>
        )}
      </div>
    </div>
  )
}
