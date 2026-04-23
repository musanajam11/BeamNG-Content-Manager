import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  X,
  RefreshCw,
  FolderOpen,
  FolderPlus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Search,
} from 'lucide-react'
import type { EditorProject } from '../../../../shared/types'

/**
 * Slide-over modal that lists every saved coop project on disk and lets the
 * user load one into BeamNG, advertise one to a live session, capture the
 * current editor state into a new project, or delete a stale one.
 *
 * Designed to be the single, unified surface for all project-recall flows
 * — replaces the bridge-tab table and the host-form load picker.
 */

/**
 * Derive the project folder basename from its on-disk absolute path.
 * `EditorProject` doesn't carry the basename directly, but the
 * `SessionProjectInfo.folder` field used for the active-project badge is
 * exactly the last path segment of the project directory.
 */
function projectFolderName(p: EditorProject): string {
  const parts = p.path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p.name
}

export interface ProjectBrowserModalProps {
  open: boolean
  onClose: () => void
  /** Currently shared session project's folder, if any (used to badge "active"). */
  activeFolder?: string | null
  /** Whether a session is currently hosting; gates the "Use in session" button. */
  isHosting: boolean
  /** Whether the BeamNG editor is reachable; gates "Load" + "Capture current". */
  editorPresent: boolean
  /** Currently loaded BeamNG level (used for the capture-current default). */
  currentLevel: string | null
  /** Called when the user picks a project to *only* stage (no hosting yet). */
  onStageForNextSession?: (p: EditorProject) => void
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function ProjectBrowserModal(props: ProjectBrowserModalProps): React.JSX.Element | null {
  const { open, onClose, activeFolder, isHosting, editorPresent, currentLevel } = props

  const [projects, setProjects] = useState<EditorProject[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      const list = await window.api.worldEditListProjects()
      setProjects(list)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const showFlash = useCallback((msg: string) => {
    setFlash(msg)
    window.setTimeout(() => setFlash((prev) => (prev === msg ? null : prev)), 2500)
  }, [])

  // Refresh on open (and when hosting toggles, since active marker can move)
  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return projects
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.levelName.toLowerCase().includes(q) ||
        projectFolderName(p).toLowerCase().includes(q)
    )
  }, [projects, query])

  const handleCaptureCurrent = useCallback(async () => {
    if (!currentLevel) {
      setErr('No level loaded — open a level in BeamNG first')
      return
    }
    const raw = window.prompt(
      `Capture the current editor state of "${currentLevel}" as a new project.\n\n` +
        'Enter a project name (letters, digits, dot, dash, underscore; max 48 chars):',
      `coop_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
    )
    if (!raw) return
    const name = raw.trim()
    if (!name) return
    setBusy(true)
    setErr(null)
    try {
      const res = await window.api.worldEditSaveProject(currentLevel, name)
      if (!res.success) setErr(res.error ?? 'Save failed')
      else {
        showFlash(`Captured: ${name}`)
        void refresh()
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }, [currentLevel, refresh, showFlash])

  const handleLoad = useCallback(
    async (p: EditorProject) => {
      if (
        !window.confirm(
          `Load project "${p.name}" (${p.levelName})?\n\n` +
            'BeamNG will reload the level. Any unsaved edits in the current session will be lost.'
        )
      )
        return
      setBusy(true)
      setErr(null)
      try {
        const res = await window.api.worldEditLoadProject(p.levelPath)
        if (!res.success) setErr(res.error ?? 'Load failed')
        else showFlash(`Loading: ${p.name}`)
      } catch (e) {
        setErr(String(e))
      } finally {
        setBusy(false)
      }
    },
    [showFlash]
  )

  const handleDelete = useCallback(
    async (p: EditorProject) => {
      if (!window.confirm(`Delete project "${p.name}" (${p.levelName})?\n\nThis cannot be undone.`))
        return
      setBusy(true)
      setErr(null)
      try {
        const res = await window.api.worldEditDeleteProject(p.path)
        if (!res.success) setErr(res.error ?? 'Delete failed')
        else {
          showFlash(`Deleted: ${p.name}`)
          void refresh()
        }
      } catch (e) {
        setErr(String(e))
      } finally {
        setBusy(false)
      }
    },
    [refresh, showFlash]
  )

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />

      {/* Slide-over panel */}
      <div className="relative w-full max-w-2xl h-full bg-[var(--color-bg)] border-l border-[var(--color-border)] shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <FolderOpen size={20} className="text-fuchsia-400" />
            <div>
              <h2 className="text-base font-semibold leading-tight">Coop projects</h2>
              <p className="text-xs text-[var(--color-text-muted)]">
                Saved editor snapshots — load one into BeamNG, or share with peers in a live session
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--color-border)]">
          <div className="flex-1 relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
            />
            <input
              type="text"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/40"
            />
          </div>
          <button
            onClick={handleCaptureCurrent}
            disabled={busy || !editorPresent}
            title={
              editorPresent
                ? 'Capture the current BeamNG editor state as a new project'
                : 'Open the BeamNG editor first'
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm border border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25 disabled:opacity-40"
          >
            <FolderPlus size={14} /> Capture current
          </button>
          <button
            onClick={() => void refresh()}
            disabled={busy}
            className="p-1.5 rounded border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
            title="Refresh"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>

        {/* Status banners */}
        {(err || flash) && (
          <div className="px-5 pt-3 space-y-2">
            {err && (
              <div className="flex items-start gap-2 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="font-mono text-xs break-all">{err}</span>
              </div>
            )}
            {flash && (
              <div className="flex items-center gap-2 px-3 py-2 rounded border border-green-500/30 bg-green-500/10 text-green-400 text-sm">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>{flash}</span>
              </div>
            )}
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-[var(--color-text-muted)]">
              {projects.length === 0 ? (
                <>
                  No saved projects yet. Click <strong>Capture current</strong> to snapshot
                  the level you're editing.
                </>
              ) : (
                <>No projects match &ldquo;{query}&rdquo;.</>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => {
                const isActive = activeFolder === projectFolderName(p)
                return (
                  <div
                    key={p.path}
                    className={`rounded-lg border p-3 transition-colors ${
                      isActive
                        ? 'border-fuchsia-500/50 bg-fuchsia-500/5'
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-border)]/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate">{p.name}</span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-semibold uppercase tracking-wide">
                              Sharing now
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)] flex items-center gap-3 flex-wrap">
                          <span>
                            Level: <span className="text-[var(--color-text)]">{p.levelName}</span>
                          </span>
                          <span className="tabular-nums">{formatBytes(p.sizeBytes)}</span>
                          <span className="tabular-nums">
                            {new Date(p.mtime).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        onClick={() => void handleLoad(p)}
                        disabled={busy || !editorPresent}
                        title="Reload BeamNG into this project (full level reload)"
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
                      >
                        <FolderOpen size={12} /> Load
                      </button>
                      <button
                        onClick={() => void handleDelete(p)}
                        disabled={busy || isActive}
                        title={
                          isActive
                            ? 'Stop sharing first before deleting'
                            : 'Delete this project folder'
                        }
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-40"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-[var(--color-border)] text-[11px] text-[var(--color-text-muted)] leading-relaxed">
          {isHosting ? (
            <>
              <strong>Use in session</strong> swaps the shared starting point mid-game — connected
              peers auto-download the new project and relaunch into it.
            </>
          ) : (
            <>
              <strong>Load</strong> reloads BeamNG into the project. Start hosting first to share a
              project with peers.
            </>
          )}
        </div>
      </div>
    </div>
  )
}
