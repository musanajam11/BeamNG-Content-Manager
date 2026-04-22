import { useState } from 'react'
import { ArrowRightLeft, Package, FileArchive, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'

/**
 * §E.6 — Project ↔ World converter UI.
 *
 * A tiny utility panel that wraps the two `worldSave:convert*` IPC
 * routes. Used outside of an active session — wraps an existing CM
 * project zip into a `.beamcmworld` shell, or extracts the embedded
 * project zip back out for editing in classic CM tools.
 *
 * The panel is intentionally minimal: pick files via the system
 * dialog, hit the button, see a result toast. There's no preview /
 * re-name / batch UI yet — those are bookmarks for later if anyone
 * actually uses the feature.
 */
export function WorldProjectConverterPanel(): React.JSX.Element {
  const [busy, setBusy] = useState<'p2w' | 'w2p' | null>(null)
  const [result, setResult] = useState<{ tone: 'ok' | 'err'; msg: string } | null>(null)

  // Project → World needs a level identifier and an author. We collect
  // them in two small inputs because the dialog flow can't easily
  // synthesize them. Pre-filled with sensible defaults.
  const [levelName, setLevelName] = useState('italy')
  const [authorDisplayName, setAuthorDisplayName] = useState('Unknown author')

  const flash = (tone: 'ok' | 'err', msg: string): void => {
    setResult({ tone, msg })
    window.setTimeout(() => setResult(null), 4000)
  }

  const onProjectToWorld = async (): Promise<void> => {
    setBusy('p2w')
    try {
      const r = await window.api.worldSaveConvertProjectToWorld?.({
        levelName: levelName.trim() || 'unknown',
        // authorId is opaque — use a stable browser-local synthetic id
        // so multi-author worlds can later merge correctly.
        authorId: getOrMintLocalAuthorId(),
        authorDisplayName: authorDisplayName.trim() || 'Unknown author',
      })
      if (!r) {
        flash('err', 'IPC binding unavailable — restart CM')
      } else if (!r.success) {
        if (!r.cancelled) flash('err', r.error ?? 'Conversion failed')
      } else {
        const mb = (r.bytes / (1024 * 1024)).toFixed(1)
        flash('ok', `Wrote ${r.path} (${mb} MB)`)
      }
    } finally {
      setBusy(null)
    }
  }

  const onWorldToProject = async (): Promise<void> => {
    setBusy('w2p')
    try {
      const r = await window.api.worldSaveConvertWorldToProject?.()
      if (!r) {
        flash('err', 'IPC binding unavailable — restart CM')
      } else if (!r.success) {
        if (!r.cancelled) flash('err', r.error ?? 'Conversion failed')
      } else {
        const mb = (r.bytes / (1024 * 1024)).toFixed(1)
        flash('ok', `Wrote ${r.path} (${mb} MB)`)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/40 p-4 space-y-4">
      <div className="flex items-start gap-3">
        <ArrowRightLeft size={18} className="text-violet-300 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Project ↔ World converter</div>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Wrap a classic CM project zip in a portable{' '}
            <code className="px-1 py-0.5 rounded bg-black/30 text-[11px]">.beamcmworld</code>{' '}
            shell, or extract one back out. Round-trips losslessly.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project → World */}
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Package size={14} className="text-violet-300" />
            Project → World
          </div>
          <div className="space-y-2">
            <label className="block text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Level name
              <input
                type="text"
                value={levelName}
                onChange={(e) => setLevelName(e.target.value)}
                placeholder="italy, smallgrid, gridmap_v2…"
                className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm font-normal normal-case tracking-normal"
              />
            </label>
            <label className="block text-[11px] uppercase tracking-wide text-[var(--color-text-muted)]">
              Your name (recorded as contributor)
              <input
                type="text"
                value={authorDisplayName}
                onChange={(e) => setAuthorDisplayName(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] text-sm font-normal normal-case tracking-normal"
              />
            </label>
          </div>
          <button
            onClick={() => void onProjectToWorld()}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-50 text-sm font-medium"
          >
            {busy === 'p2w' ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
            Wrap project zip…
          </button>
        </div>

        {/* World → Project */}
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <FileArchive size={14} className="text-emerald-300" />
            World → Project
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Extracts the embedded project zip from a{' '}
            <code className="px-1 py-0.5 rounded bg-black/30 text-[11px]">.beamcmworld</code>{' '}
            so you can edit it in classic CM. Only works on worlds produced by the wrapper above —
            session-saved worlds carry no project zip.
          </p>
          <button
            onClick={() => void onWorldToProject()}
            disabled={busy !== null}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 text-sm font-medium"
          >
            {busy === 'w2p' ? <Loader2 size={14} className="animate-spin" /> : <FileArchive size={14} />}
            Extract project zip…
          </button>
        </div>
      </div>

      {result && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs border ${
            result.tone === 'ok'
              ? 'border-green-500/30 bg-green-500/10 text-green-300'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {result.tone === 'ok' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertCircle size={14} className="mt-0.5 shrink-0" />}
          <span className="flex-1 break-all">{result.msg}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Mint (or read) a stable per-browser-profile synthetic author id. We
 * deliberately don't reach for the real BeamMP username here — the
 * converter runs outside any session, so we have nothing live to ask.
 * The session controller's `getAuthorId()` shape is preserved so a
 * later merge of contributor lists (Tier 6) works the same way.
 */
function getOrMintLocalAuthorId(): string {
  const KEY = 'cm.worldConverter.authorId'
  try {
    const existing = window.localStorage.getItem(KEY)
    if (existing && existing.length > 0) return existing
  } catch { /* private mode — fall through */ }
  // crypto.randomUUID is available in all Electron renderers we ship.
  const fresh = `local-${crypto.randomUUID()}`
  try { window.localStorage.setItem(KEY, fresh) } catch { /* non-fatal */ }
  return fresh
}
