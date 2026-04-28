// Generic editor for "drop-in" server-mod JSON configs.
//
// Reads the descriptor's directory at runtime, exposes every JSON file
// it finds, and renders an auto-generated form per file. Field types are
// inferred from the loaded value:
//   • boolean   → checkbox
//   • number    → number input
//   • string    → text input
//   • object    → nested collapsible group
//   • array     → editable list (scalars) or JSON textarea (objects)
//   • null      → text input that round-trips empty string ↔ null
//
// Saving writes the entire file back as pretty JSON; we never re-order
// or strip keys so anything the form doesn't surface is preserved.

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Save, FileJson, AlertTriangle, Info } from 'lucide-react'
import type { ModConfigBundle, ModConfigFile } from '../../../../shared/modConfigDescriptors'

interface Props {
  serverId: string
  descriptorId: string
  displayName: string
  blurb?: string
  /** Hide the section entirely if the mod isn't installed. Defaults to true. */
  hideWhenAbsent?: boolean
}

type LoadState =
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'ready'; bundle: ModConfigBundle }
  | { status: 'error'; message: string }

export function DynamicModConfigSection({
  serverId,
  descriptorId,
  displayName,
  blurb,
  hideWhenAbsent = true,
}: Props): React.JSX.Element | null {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const bundle = await window.api.modConfigLoadBundle(serverId, descriptorId)
      if (!bundle || !bundle.installed) {
        setState({ status: 'absent' })
        return
      }
      setState({ status: 'ready', bundle })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [serverId, descriptorId])

  useEffect(() => { void load() }, [load])

  if (state.status === 'absent' && hideWhenAbsent) return null

  return (
    <div className="mt-6 p-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
            {displayName}
          </h3>
          {blurb && (
            <p className="text-xs text-[var(--color-text-muted)] truncate">{blurb}</p>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline"
        >
          Reload
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      )}

      {state.status === 'absent' && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200">
            Not installed for this server.
          </div>
        </div>
      )}

      {state.status === 'error' && (
        <div className="text-xs text-red-400">{state.message}</div>
      )}

      {state.status === 'ready' && state.bundle.files.length === 0 && (
        <div className="flex items-start gap-2 p-3 rounded border border-amber-500/30 bg-amber-500/5">
          <Info size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-200">
            No JSON config files found in <code className="font-mono">{state.bundle.absDir}</code>.
            Start the server at least once to let the mod generate them.
          </div>
        </div>
      )}

      {state.status === 'ready' && state.bundle.files.length > 0 && (
        <div className="space-y-2">
          {state.bundle.files.map((f) => (
            <FileEditor
              key={f.relPath}
              serverId={serverId}
              descriptorId={descriptorId}
              file={f}
              onSaved={() => void load()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── per-file editor ───────────────────────── */

interface FileEditorProps {
  serverId: string
  descriptorId: string
  file: ModConfigFile
  onSaved: () => void
}

function FileEditor({ serverId, descriptorId, file, onSaved }: FileEditorProps): React.JSX.Element {
  // Default-open the first file only when there's a small number of fields,
  // otherwise users get a wall of inputs. Heuristic: keep collapsed.
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<unknown>(file.content)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // Re-sync when the parent reloads.
  useEffect(() => { setValue(file.content); setDirty(false); setMessage(null) }, [file])

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await window.api.modConfigSaveFile(serverId, descriptorId, file.relPath, value)
      if (res.success) {
        setMessage('Saved')
        setDirty(false)
        onSaved()
      } else {
        setMessage(res.error ?? 'Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  const updateValue = (next: unknown): void => {
    setValue(next)
    setDirty(true)
    setMessage(null)
  }

  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--color-surface-hover)] transition-colors"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileJson size={14} className="text-[var(--color-text-muted)]" />
        <span className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {file.relPath}
        </span>
        {file.parseError && (
          <AlertTriangle size={14} className="text-rose-400 shrink-0" />
        )}
        {!file.exists && (
          <span className="text-[10px] text-[var(--color-text-muted)] uppercase">missing</span>
        )}
        {dirty && (
          <span className="ml-auto text-[10px] text-amber-400 uppercase">unsaved</span>
        )}
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] p-3 space-y-3">
          {file.parseError && (
            <div className="text-xs text-rose-400">
              Parse error: {file.parseError}
            </div>
          )}

          {!file.exists ? (
            <div className="text-xs text-[var(--color-text-muted)]">
              File doesn't exist yet — start the server once so the mod can create it.
            </div>
          ) : (
            <ValueEditor value={value} path="" onChange={updateValue} />
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-border)]">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty || !file.exists}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save'}
            </button>
            {message && (
              <span className="text-xs text-[var(--color-text-muted)]">{message}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────────────────────── recursive value editor ───────────────────────── */

interface ValueEditorProps {
  value: unknown
  path: string  // dotted breadcrumb for keys (debug / labels)
  onChange: (next: unknown) => void
}

function ValueEditor({ value, path, onChange }: ValueEditorProps): React.JSX.Element {
  // Object → nested grid of fields (one section per key).
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return <ObjectEditor obj={value as Record<string, unknown>} path={path} onChange={onChange} />
  }
  // Top-level arrays show as a list editor.
  if (Array.isArray(value)) {
    return <ArrayEditor arr={value} path={path} onChange={onChange} />
  }
  // Primitives at the root would be unusual — render single input.
  return <PrimitiveEditor label={path || 'value'} value={value} onChange={onChange} />
}

function ObjectEditor({
  obj,
  path,
  onChange,
}: {
  obj: Record<string, unknown>
  path: string
  onChange: (next: unknown) => void
}): React.JSX.Element {
  const keys = Object.keys(obj)
  const updateKey = (k: string, v: unknown): void => {
    onChange({ ...obj, [k]: v })
  }

  // Split keys into "primitive leaves" (laid out in a 2-col grid) and
  // "complex" nested objects/arrays (rendered full-width below).
  const primitives = keys.filter((k) => isPrimitive(obj[k]))
  const complex = keys.filter((k) => !isPrimitive(obj[k]))

  return (
    <div className="space-y-3">
      {primitives.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {primitives.map((k) => (
            <PrimitiveEditor
              key={k}
              label={k}
              value={obj[k]}
              onChange={(v) => updateKey(k, v)}
            />
          ))}
        </div>
      )}
      {complex.map((k) => (
        <NestedSection key={k} title={k} path={path ? `${path}.${k}` : k}>
          <ValueEditor
            value={obj[k]}
            path={path ? `${path}.${k}` : k}
            onChange={(v) => updateKey(k, v)}
          />
        </NestedSection>
      ))}
    </div>
  )
}

function NestedSection({
  title,
  path,
  children,
}: {
  title: string
  path: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-[var(--color-surface-hover)]"
        title={path}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">{title}</span>
      </button>
      {open && <div className="border-t border-[var(--color-border)] p-3">{children}</div>}
    </div>
  )
}

function ArrayEditor({
  arr,
  path,
  onChange,
}: {
  arr: unknown[]
  path: string
  onChange: (next: unknown) => void
}): React.JSX.Element {
  const allPrim = arr.every(isPrimitive)
  // Mixed/object arrays fall back to raw JSON so we don't lose structure.
  if (!allPrim) {
    return <JsonTextareaEditor value={arr} onChange={onChange} />
  }

  const updateAt = (i: number, v: unknown): void => {
    const next = [...arr]
    next[i] = v
    onChange(next)
  }
  const removeAt = (i: number): void => {
    onChange(arr.filter((_, idx) => idx !== i))
  }
  const add = (): void => {
    // Default new item type matches the first existing one (else string).
    const sample = arr[0]
    const blank: unknown =
      typeof sample === 'number' ? 0 :
      typeof sample === 'boolean' ? false : ''
    onChange([...arr, blank])
  }

  return (
    <div className="space-y-2" title={path}>
      {arr.length === 0 && (
        <div className="text-xs text-[var(--color-text-muted)] italic">empty list</div>
      )}
      {arr.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="flex-1">
            <PrimitiveEditor label={`[${i}]`} value={item} onChange={(v) => updateAt(i, v)} />
          </div>
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="text-xs text-[var(--color-accent)] hover:underline"
      >
        + add
      </button>
    </div>
  )
}

function PrimitiveEditor({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
}): React.JSX.Element {
  if (typeof value === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs">{label}</span>
      </label>
    )
  }
  if (typeof value === 'number') {
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-text-muted)] font-mono">{label}</span>
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) ? n : 0)
          }}
          className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
        />
      </label>
    )
  }
  // string | null | undefined
  const str = value == null ? '' : String(value)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-[var(--color-text-muted)] font-mono">{label}</span>
      <input
        type="text"
        value={str}
        onChange={(e) => {
          const v = e.target.value
          // Round-trip null when the field was originally null and is cleared.
          onChange(value === null && v === '' ? null : v)
        }}
        className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-accent)] outline-none rounded"
      />
    </label>
  )
}

function JsonTextareaEditor({
  value,
  onChange,
}: {
  value: unknown
  onChange: (v: unknown) => void
}): React.JSX.Element {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState<string | null>(null)
  // Re-sync when the parent value identity changes (e.g. Reload).
  useEffect(() => { setText(JSON.stringify(value, null, 2)); setError(null) }, [value])

  return (
    <div className="space-y-1">
      <textarea
        value={text}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          try {
            const parsed = JSON.parse(next)
            setError(null)
            onChange(parsed)
          } catch (err) {
            setError(String(err))
          }
        }}
        rows={Math.min(20, Math.max(4, text.split('\n').length))}
        className="w-full font-mono text-xs px-2 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
      />
      {error && <div className="text-xs text-rose-400">{error}</div>}
      <div className="text-[10px] text-[var(--color-text-muted)]">
        Complex array — edited as raw JSON. Invalid JSON disables save.
      </div>
    </div>
  )
}

function isPrimitive(v: unknown): boolean {
  return v === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof v)
}
