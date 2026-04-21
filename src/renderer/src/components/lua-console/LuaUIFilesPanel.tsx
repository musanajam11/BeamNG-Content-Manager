import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { ChevronRight, ChevronDown, FileText, Folder, RefreshCw, Save, RotateCcw, FolderOpen, Settings as SettingsIcon, GitCommit, Undo2, FolderPlus, Trash2, WrapText, Map as MapIcon } from 'lucide-react'
import { useToastStore } from '@renderer/stores/useToastStore'
import { useDevEditorStore } from '@renderer/stores/useDevEditorStore'
import { STORAGE_KEYS, loadJSON, saveJSON } from './luaConsoleShared'

export interface UIRoot {
  id: string
  label: string
  path: string
  kind: 'userUi' | 'modUi' | 'installUi'
  writable: boolean
  modName?: string
}
interface TreeNode {
  name: string
  path: string // root-relative
  isDirectory: boolean
  loaded?: boolean
  expanded?: boolean
  children?: TreeNode[]
}

// Hard block-list: known binary formats the Monaco editor can't do anything
// useful with. Anything outside this list is attempted as text (with a runtime
// null-byte sniff on read — see `beamUIReadFileSmart`).
const BINARY_EXT = new Set([
  // BeamNG-specific binaries
  'cdae','dds','uft','pma',
  // Archives / packages
  'zip','7z','rar','gz','tar','bz2','xz','jar','apk','pk3','pk7','cab','iso',
  // Executables / native libs
  'exe','dll','so','dylib','com','msi','bin','o','a','lib','class',
  // Databases
  'db','sqlite','sqlite3','ldb','db-journal','mdb',
  // Media (non-image)
  'mp3','wav','ogg','flac','m4a','mp4','mov','avi','mkv','webm','mpg','mpeg','aac','opus',
  // 3D / game
  'kn5','fbx','obj','gltf','glb','stl','bam','uasset','pkm',
  // Fonts
  'ttf','otf','woff','woff2','eot','ttc',
  // Misc
  'pdf','psd','ai','indd','eps',
])

// Images we can preview inline via a data URL (renderer-side <img>).
const PREVIEWABLE_IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

function classifyFile(name: string): 'image' | 'binary' | 'text' {
  const e = extOf(name)
  if (PREVIEWABLE_IMAGE_EXT[e]) return 'image'
  if (BINARY_EXT.has(e)) return 'binary'
  return 'text'
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function langForFile(name: string): string {
  // Strip `.old` / `.bak*` suffixes so backup files inherit their stem's language.
  // (e.g. `foo.json.old` → `json`, `bindings.diff.bak_moneyedit` → `diff`.)
  let target = name
  // Repeatedly strip backup-style trailing extensions.
  while (true) {
    const e = extOf(target)
    if (e === 'old' || e.startsWith('bak')) {
      target = target.slice(0, target.length - e.length - 1)
      continue
    }
    break
  }
  const e = extOf(target)
  switch (e) {
    case 'html': case 'htm': return 'html'
    case 'js': case 'mjs': case 'cjs': return 'javascript'
    case 'jsx': return 'javascript'
    case 'ts': return 'typescript'
    case 'tsx': return 'typescript'
    case 'css': return 'css'
    case 'scss': case 'sass': return 'scss'
    case 'less': return 'less'
    case 'json': return 'json'
    // BeamNG JSON-flavoured formats (JSONC-ish — comments & trailing commas tolerated by Monaco's JSON parser when we just display them as text-ish JSON).
    case 'jbeam':
    case 'pc':
    case 'diff':
    case 'postfx':
    case 'flow':
    case 'flowgraph':
    case 'mission':
    case 'materials':
    case 'forest4':
    case 'prefab':
    case 'level':
      return 'json'
    case 'vue': return 'html'
    case 'yaml': case 'yml': return 'yaml'
    case 'lua': return 'lua'
    case 'md': case 'markdown': return 'markdown'
    case 'xml': case 'svg': return 'xml'
    case 'sh': case 'bash': return 'shell'
    case 'bat': case 'cmd': return 'bat'
    case 'ps1': case 'psm1': return 'powershell'
    case 'ini': case 'cfg': case 'conf': case 'toml': return 'ini'
    case 'glsl': case 'vert': case 'frag': return 'cpp'
    // BeamNG `.cs` is TorqueScript, not C#. Monaco has no TorqueScript grammar;
    // plaintext is safer than mis-highlighting it as C#.
    case 'cs': return 'plaintext'
    case 'log': case 'txt': return 'plaintext'
    default: return 'plaintext'
  }
}

interface Props {
  onReloadUI?: () => void
}

/** Per-file open state held in memory (preserves Monaco model + dirty flag across file switches). */
interface OpenFileState {
  /** root-relative path */
  path: string
  rootId: string
  /** Saved (= what's on disk now). */
  savedContent: string
  /** Editor buffer (= what user typed). */
  bufferContent: string
  language: string
}

interface ProjectInfo { name: string; savedAt: number; fileCount: number }

function fileKey(rootId: string, subPath: string): string { return `${rootId}\u0000${subPath}` }

export function LuaUIFilesPanel({ onReloadUI }: Props): React.JSX.Element {
  const addToast = useToastStore((s) => s.addToast)
  const [roots, setRoots] = useState<UIRoot[]>([])
  const [allowInstall, setAllowInstall] = useState<boolean>(() => loadJSON<boolean>(STORAGE_KEYS.uiFilesAllowInstall, false) ?? false)
  const [installWritable, setInstallWritable] = useState<boolean>(() => loadJSON<boolean>(STORAGE_KEYS.uiFilesInstallWritable, false) ?? false)
  const [activeRootId, setActiveRootId] = useState<string | null>(() => loadJSON<string | null>(STORAGE_KEYS.uiFilesLastRoot, null) ?? null)
  const [openPath, setOpenPath] = useState<string | null>(() => loadJSON<string | null>(STORAGE_KEYS.uiFilesLastPath, null) ?? null)
  const [tree, setTree] = useState<TreeNode | null>(null)
  // Multi-file open buffers — preserves dirty state when switching between files
  // AND across page navigation (seeded from / synced to the persisted dev-editor store).
  const persistedOpenFiles = useDevEditorStore((s) => s.openFiles)
  const persistOpenFiles = useDevEditorStore((s) => s.setOpenFiles)
  const [openFiles, setOpenFiles] = useState<Map<string, OpenFileState>>(
    () => new Map(Object.entries(persistedOpenFiles))
  )
  // Push every local change into the store so unmount preserves them. Debounced
  // (500 ms) — avoids serializing every buffer to localStorage on every
  // keystroke, which becomes expensive once several large files are open. We
  // always flush the latest value on unmount so nothing is lost when leaving
  // the page mid-keystroke.
  const latestOpenFilesRef = useRef(openFiles)
  latestOpenFilesRef.current = openFiles
  useEffect(() => {
    const h = setTimeout(() => { persistOpenFiles(Object.fromEntries(openFiles)) }, 500)
    return () => clearTimeout(h)
  }, [openFiles, persistOpenFiles])
  useEffect(() => {
    return () => { persistOpenFiles(Object.fromEntries(latestOpenFilesRef.current)) }
  }, [persistOpenFiles])
  // Image / binary preview state for the currently-open non-editable file.
  const [preview, setPreview] = useState<
    | { kind: 'image'; dataUrl: string; size: number }
    | { kind: 'binary'; size: number; reason: string }
    | null
  >(null)
  // Staged-but-uncommitted set (rootId\0subPath).
  const [stagedKeys, setStagedKeys] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showProjects, setShowProjects] = useState(false)
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [activeProject, setActiveProject] = useState<string | null>(() => loadJSON<string | null>(STORAGE_KEYS.uiFilesActiveProject, null) ?? null)
  const [autoRevert, setAutoRevert] = useState<boolean>(false)
  const [diag, setDiag] = useState<{ userDir?: string | null; installDir?: string | null }>({})
  const [treeWidth, setTreeWidth] = useState<number>(() => loadJSON<number>(STORAGE_KEYS.uiFilesTreeWidth, 280) ?? 280)
  const [wordWrap, setWordWrap] = useState<boolean>(() => loadJSON<boolean>(STORAGE_KEYS.uiFilesWordWrap, true) ?? true)
  const [minimap, setMinimap] = useState<boolean>(() => loadJSON<boolean>(STORAGE_KEYS.uiFilesMinimap, true) ?? true)

  const currentKey = openPath && activeRootId ? fileKey(activeRootId, openPath) : null
  const currentFile = currentKey ? openFiles.get(currentKey) ?? null : null
  const content = currentFile?.bufferContent ?? ''
  const dirty = !!currentFile && currentFile.bufferContent !== currentFile.savedContent
  const uncommitted = currentKey ? stagedKeys.has(currentKey) : false
  // Aggregate dirty/uncommitted across all open files (for header badges).
  const dirtyCount = useMemo(() => {
    let n = 0
    openFiles.forEach((f) => { if (f.bufferContent !== f.savedContent) n += 1 })
    return n
  }, [openFiles])
  const uncommittedCount = stagedKeys.size

  // Aggregate dirty/staged markers onto ancestor folder paths for the current root so the
  // indicator is visible even when the folder is collapsed.
  const { dirtyFolders, stagedFolders } = useMemo(() => {
    const dirty = new Set<string>()
    const staged = new Set<string>()
    if (!activeRootId) return { dirtyFolders: dirty, stagedFolders: staged }
    const prefix = `${activeRootId}\u0000`
    const addAncestors = (target: Set<string>, subPath: string): void => {
      // Mark every ancestor folder (exclusive of the leaf itself) as containing a marker.
      let slash = subPath.lastIndexOf('/')
      while (slash > 0) {
        target.add(subPath.slice(0, slash))
        slash = subPath.lastIndexOf('/', slash - 1)
      }
      // Root-level files: mark empty path so the root label could show it if desired.
      if (subPath && subPath.indexOf('/') === -1) target.add('')
    }
    openFiles.forEach((f, key) => {
      if (!key.startsWith(prefix)) return
      if (f.bufferContent === f.savedContent) return
      addAncestors(dirty, f.path)
    })
    stagedKeys.forEach((key) => {
      if (!key.startsWith(prefix)) return
      const subPath = key.slice(prefix.length)
      addAncestors(staged, subPath)
    })
    return { dirtyFolders: dirty, stagedFolders: staged }
  }, [openFiles, stagedKeys, activeRootId])

  const activeRoot = useMemo(() => roots.find((r) => r.id === activeRootId) ?? null, [roots, activeRootId])

  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesAllowInstall, allowInstall) }, [allowInstall])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesInstallWritable, installWritable) }, [installWritable])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesLastRoot, activeRootId) }, [activeRootId])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesLastPath, openPath) }, [openPath])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesTreeWidth, treeWidth) }, [treeWidth])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesActiveProject, activeProject) }, [activeProject])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesWordWrap, wordWrap) }, [wordWrap])
  useEffect(() => { saveJSON(STORAGE_KEYS.uiFilesMinimap, minimap) }, [minimap])

  const refreshStaged = useCallback(async () => {
    try {
      const list = await window.api.beamUIListStaged()
      setStagedKeys(new Set(list.map((c) => fileKey(c.rootId, c.subPath))))
    } catch { /* ignore */ }
  }, [])

  const refreshProjects = useCallback(async () => {
    try { setProjects(await window.api.beamUIListProjects()) } catch { /* ignore */ }
  }, [])

  // Subscribe to "staging changed" events from the main process (e.g. game-exit auto-revert).
  useEffect(() => {
    const off = window.api.onBeamUIStagingChanged((data) => {
      void refreshStaged()
      if (data.reason === 'gameExit' && (data.reverted ?? 0) > 0) {
        addToast(`Reverted ${data.reverted} uncommitted UI file change${data.reverted === 1 ? '' : 's'} (game exited)`, 'info')
        // Re-read the currently-open file so the editor reflects the revert.
        if (currentKey && currentFile) {
          void (async () => {
            try {
              const text = await window.api.beamUIReadFile({ rootId: currentFile.rootId, subPath: currentFile.path })
              setOpenFiles((prev) => {
                const next = new Map(prev)
                next.set(currentKey, { ...currentFile, savedContent: text, bufferContent: text })
                return next
              })
            } catch { /* file may have been deleted */ }
          })()
        }
      }
    })
    void window.api.beamUIGetAutoRevert().then(setAutoRevert).catch(() => { /* ignore */ })
    void refreshStaged()
    return () => { off() }
  }, [addToast, currentFile, currentKey, refreshStaged])


  const refreshRoots = useCallback(async () => {
    try {
      const res = await window.api.beamUIListRoots({ includeInstall: allowInstall, installWritable })
      setRoots(res.roots)
      setDiag({ userDir: res.resolvedUserDir, installDir: res.resolvedInstallDir })
      if (!res.roots.find((x) => x.id === activeRootId)) {
        setActiveRootId(res.roots[0]?.id ?? null)
      }
    } catch (err) {
      addToast(`Failed to load UI roots: ${(err as Error).message}`, 'error')
    }
  }, [allowInstall, installWritable, activeRootId, addToast])

  useEffect(() => { void refreshRoots() }, [refreshRoots])

  // Load root tree when activeRoot changes
  useEffect(() => {
    if (!activeRoot) { setTree(null); return }
    let cancelled = false
    void (async () => {
      try {
        const entries = await window.api.beamUIListDir({ rootId: activeRoot.id, subPath: '' })
        if (cancelled) return
        const root: TreeNode = {
          name: activeRoot.label,
          path: '',
          isDirectory: true,
          loaded: true,
          expanded: true,
          children: entries.map((e) => ({ name: e.name, path: e.name, isDirectory: e.isDirectory })),
        }
        setTree(root)
      } catch (err) {
        addToast(`List failed: ${(err as Error).message}`, 'error')
      }
    })()
    return () => { cancelled = true }
  }, [activeRoot, addToast])

  const expandFolder = useCallback(async (node: TreeNode) => {
    if (!activeRoot) return
    if (!node.loaded) {
      try {
        const entries = await window.api.beamUIListDir({ rootId: activeRoot.id, subPath: node.path })
        node.children = entries.map((e) => ({ name: e.name, path: node.path ? `${node.path}/${e.name}` : e.name, isDirectory: e.isDirectory }))
        node.loaded = true
      } catch (err) {
        addToast(`List failed: ${(err as Error).message}`, 'error')
        return
      }
    }
    node.expanded = !node.expanded
    setTree((t) => (t ? { ...t } : t))
  }, [activeRoot, addToast])

  const openFile = useCallback(async (path: string) => {
    if (!activeRoot) return
    const key = fileKey(activeRoot.id, path)
    setPreview(null)
    // Already in our open buffer — just switch to it (preserves dirty state).
    if (openFiles.has(key)) {
      setOpenPath(path)
      return
    }
    const kind = classifyFile(path)
    setLoading(true)
    try {
      if (kind === 'image') {
        const mime = PREVIEWABLE_IMAGE_EXT[extOf(path)] ?? 'application/octet-stream'
        const r = await window.api.beamUIReadBinaryDataUrl({ rootId: activeRoot.id, subPath: path, mime, maxBytes: 16 * 1024 * 1024 })
        if (r.truncated) {
          setPreview({ kind: 'binary', size: r.size, reason: `File is too large to preview (${(r.size / 1024 / 1024).toFixed(1)} MB).` })
        } else {
          setPreview({ kind: 'image', dataUrl: r.dataUrl, size: r.size })
        }
        setOpenPath(path)
      } else if (kind === 'binary') {
        setPreview({ kind: 'binary', size: 0, reason: 'Binary file — not editable.' })
        setOpenPath(path)
      } else {
        // Use the size-capped text reader + null-byte sniff so unknown-extension
        // text files still open, while real binaries aren't dumped into Monaco.
        const r = await window.api.beamUIReadFileSmart({ rootId: activeRoot.id, subPath: path, maxBytes: 4 * 1024 * 1024 })
        if (r.kind === 'binary') {
          setPreview({ kind: 'binary', size: r.size, reason: 'File contains binary data (null bytes detected).' })
          setOpenPath(path)
        } else {
          if (r.truncated) {
            addToast(`Large file truncated to first 4 MB — save will overwrite the whole file.`, 'info')
          }
          setOpenFiles((prev) => {
            const next = new Map(prev)
            next.set(key, {
              path,
              rootId: activeRoot.id,
              savedContent: r.content,
              bufferContent: r.content,
              language: langForFile(path),
            })
            return next
          })
          setOpenPath(path)
        }
      }
    } catch (err) {
      addToast(`Open failed: ${(err as Error).message}`, 'error')
    } finally { setLoading(false) }
  }, [activeRoot, openFiles, addToast])

  const setBuffer = useCallback((value: string) => {
    if (!currentKey) return
    setOpenFiles((prev) => {
      const f = prev.get(currentKey)
      if (!f) return prev
      const next = new Map(prev)
      next.set(currentKey, { ...f, bufferContent: value })
      return next
    })
  }, [currentKey])

  const saveFile = useCallback(async () => {
    if (!activeRoot || !openPath || !currentKey || !currentFile) return
    if (!activeRoot.writable) { addToast('Root is read-only', 'error'); return }
    if (!dirty) return
    setSaving(true)
    try {
      await window.api.beamUIWriteFile({ rootId: activeRoot.id, subPath: openPath, content: currentFile.bufferContent })
      setOpenFiles((prev) => {
        const f = prev.get(currentKey)
        if (!f) return prev
        const next = new Map(prev)
        next.set(currentKey, { ...f, savedContent: f.bufferContent })
        return next
      })
      void refreshStaged()
      addToast('Saved (uncommitted — will revert on game exit)', 'success')
    } catch (err) {
      addToast(`Save failed: ${(err as Error).message}`, 'error')
    } finally { setSaving(false) }
  }, [activeRoot, openPath, currentKey, currentFile, dirty, addToast, refreshStaged])

  /** Save all dirty open files (best-effort). */
  const saveAll = useCallback(async () => {
    setSaving(true)
    try {
      const tasks: Array<Promise<void>> = []
      const updates: Array<[string, OpenFileState]> = []
      openFiles.forEach((f, key) => {
        if (f.bufferContent === f.savedContent) return
        const root = roots.find((r) => r.id === f.rootId)
        if (!root?.writable) return
        tasks.push(
          window.api.beamUIWriteFile({ rootId: f.rootId, subPath: f.path, content: f.bufferContent })
            .then(() => { updates.push([key, { ...f, savedContent: f.bufferContent }]) })
            .catch((err) => addToast(`Save failed (${f.path}): ${(err as Error).message}`, 'error')),
        )
      })
      await Promise.all(tasks)
      if (updates.length) {
        setOpenFiles((prev) => {
          const next = new Map(prev)
          for (const [k, v] of updates) next.set(k, v)
          return next
        })
        addToast(`Saved ${updates.length} file${updates.length === 1 ? '' : 's'}`, 'success')
      }
      void refreshStaged()
    } finally { setSaving(false) }
  }, [openFiles, roots, addToast, refreshStaged])

  const commitCurrent = useCallback(async () => {
    if (!activeRoot || !openPath) return
    if (dirty) { addToast('Save before committing', 'error'); return }
    setCommitting(true)
    try {
      await window.api.beamUICommit({ rootId: activeRoot.id, subPath: openPath })
      void refreshStaged()
      addToast('Committed — change is now permanent', 'success')
    } catch (err) {
      addToast(`Commit failed: ${(err as Error).message}`, 'error')
    } finally { setCommitting(false) }
  }, [activeRoot, openPath, dirty, addToast, refreshStaged])

  const commitAll = useCallback(async () => {
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} file${dirtyCount === 1 ? '' : 's'} have unsaved buffer changes that won't be included. Commit anyway?`)) return
    setCommitting(true)
    try {
      const r = await window.api.beamUICommitAll()
      void refreshStaged()
      addToast(`Committed ${r.committed} file${r.committed === 1 ? '' : 's'}`, 'success')
    } catch (err) {
      addToast(`Commit-all failed: ${(err as Error).message}`, 'error')
    } finally { setCommitting(false) }
  }, [dirtyCount, addToast, refreshStaged])

  const revertCurrent = useCallback(async () => {
    if (!activeRoot || !openPath || !currentKey) return
    if (!window.confirm(`Revert "${openPath}" to the original on-disk content?`)) return
    try {
      await window.api.beamUIRevert({ rootId: activeRoot.id, subPath: openPath })
      // Re-read whatever is now on disk (may be the original, or gone if file was created).
      try {
        const text = await window.api.beamUIReadFile({ rootId: activeRoot.id, subPath: openPath })
        setOpenFiles((prev) => {
          const f = prev.get(currentKey)
          if (!f) return prev
          const next = new Map(prev)
          next.set(currentKey, { ...f, savedContent: text, bufferContent: text })
          return next
        })
      } catch {
        // file no longer exists — drop the open buffer
        setOpenFiles((prev) => { const n = new Map(prev); n.delete(currentKey); return n })
        setOpenPath(null)
      }
      void refreshStaged()
      addToast('Reverted', 'success')
    } catch (err) {
      addToast(`Revert failed: ${(err as Error).message}`, 'error')
    }
  }, [activeRoot, openPath, currentKey, addToast, refreshStaged])

  const revertAll = useCallback(async () => {
    if (!window.confirm('Revert ALL uncommitted UI file changes to their originals?')) return
    try {
      const r = await window.api.beamUIRevertAll()
      // Re-read currently open file from disk if it still exists.
      if (currentKey && currentFile) {
        try {
          const text = await window.api.beamUIReadFile({ rootId: currentFile.rootId, subPath: currentFile.path })
          setOpenFiles((prev) => {
            const f = prev.get(currentKey); if (!f) return prev
            const next = new Map(prev)
            next.set(currentKey, { ...f, savedContent: text, bufferContent: text })
            return next
          })
        } catch { /* may be gone */ }
      }
      void refreshStaged()
      addToast(`Reverted ${r.reverted} file${r.reverted === 1 ? '' : 's'}`, 'success')
    } catch (err) {
      addToast(`Revert-all failed: ${(err as Error).message}`, 'error')
    }
  }, [currentKey, currentFile, addToast, refreshStaged])

  const closeBuffer = useCallback((key: string) => {
    setOpenFiles((prev) => {
      const f = prev.get(key)
      if (f && f.bufferContent !== f.savedContent && !window.confirm(`Discard unsaved buffer for "${f.path}"?`)) return prev
      const next = new Map(prev)
      next.delete(key)
      return next
    })
    if (currentKey === key) setOpenPath(null)
  }, [currentKey])

  // Ctrl+S inside Monaco
  const handleEditorMount: OnMount = (editor, monaco) => {
    monaco.editor.defineTheme('beammp-devtools', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#00000012',
        'editorGutter.background': '#00000000',
        'minimap.background': '#00000010',
        'editor.lineHighlightBackground': '#ffffff08',
        'editor.selectionBackground': '#f9731640',
        'editor.inactiveSelectionBackground': '#ffffff14',
        'scrollbar.shadow': '#00000000',
        'editorWidget.background': '#00000066',
        'editorWidget.border': '#ffffff18',
      },
    })
    monaco.editor.setTheme('beammp-devtools')
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { void saveFile() })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => { void saveAll() })
  }

  // Tree drag-resize
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const onDragStart = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startW: treeWidth }
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.clientX - dragRef.current.startX
      setTreeWidth(Math.max(180, Math.min(600, dragRef.current.startW + dx)))
    }
    const up = () => { dragRef.current = null; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // A file is editable when we have a text buffer for it. Images and binaries
  // are shown via `preview` instead (see render below).
  const isEditable = !!currentFile

  // Clear the image/binary preview whenever we switch to a text buffer — tabs
  // only exist for text files, so any navigation into one means we're done
  // previewing.
  useEffect(() => {
    if (currentFile && preview) setPreview(null)
  }, [currentFile, preview])

  return (
    <div className="flex h-full flex-col bg-[var(--color-scrim-10)] text-[var(--color-text-primary)] backdrop-blur-md">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] px-2 py-1.5">
        <select
          className="rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-2 py-1 text-xs text-[var(--color-text-primary)]"
          value={activeRootId ?? ''}
          onChange={(e) => setActiveRootId(e.target.value || null)}
        >
          <option value="">— select root —</option>
          {roots.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}{!r.writable ? ' (read-only)' : ''}
            </option>
          ))}
        </select>
        <button onClick={() => void refreshRoots()} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" title="Refresh roots"><RefreshCw size={14} /></button>
        {activeRoot && (
          <button
            onClick={() => void window.api.beamUIRevealInExplorer({ rootId: activeRoot.id, subPath: openPath ?? '' })}
            className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            title="Reveal in Explorer"
          ><FolderOpen size={14} /></button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(dirtyCount > 0 || uncommittedCount > 0) && (
            <span className="text-[10px] text-zinc-400">
              {dirtyCount > 0 && <span className="mr-2 text-amber-400">● {dirtyCount} unsaved</span>}
              {uncommittedCount > 0 && <span className="text-sky-400">◆ {uncommittedCount} uncommitted</span>}
            </span>
          )}
          <ProjectMenu
            open={showProjects}
            onToggle={() => { if (!showProjects) void refreshProjects(); setShowProjects((v) => !v) }}
            projects={projects}
            activeProject={activeProject}
            onSave={async (name) => {
              try {
                const r = await window.api.beamUISaveProject({ name })
                setActiveProject(name)
                addToast(`Project "${name}" saved (${r.fileCount} file${r.fileCount === 1 ? '' : 's'})`, 'success')
                void refreshProjects()
              } catch (err) { addToast(`Save project failed: ${(err as Error).message}`, 'error') }
            }}
            onLoad={async (name) => {
              try {
                const r = await window.api.beamUILoadProject({ name })
                setActiveProject(name)
                void refreshStaged()
                addToast(`Loaded "${name}" — ${r.applied} applied${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`, r.skipped.length ? 'info' : 'success')
                if (r.skipped.length) console.warn('Skipped:', r.skipped)
              } catch (err) { addToast(`Load project failed: ${(err as Error).message}`, 'error') }
            }}
            onDelete={async (name) => {
              if (!window.confirm(`Delete project "${name}"?`)) return
              try {
                await window.api.beamUIDeleteProject({ name })
                if (activeProject === name) setActiveProject(null)
                addToast(`Deleted "${name}"`, 'success')
                void refreshProjects()
              } catch (err) { addToast(`Delete failed: ${(err as Error).message}`, 'error') }
            }}
          />
          <button
            onClick={() => setWordWrap((v) => !v)}
            className={`rounded p-1 hover:bg-[var(--color-surface-hover)] ${wordWrap ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}
            title={wordWrap ? 'Word wrap: on' : 'Word wrap: off'}
          ><WrapText size={14} /></button>
          <button
            onClick={() => setMinimap((v) => !v)}
            className={`rounded p-1 hover:bg-[var(--color-surface-hover)] ${minimap ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)]'}`}
            title={minimap ? 'Minimap: on' : 'Minimap: off'}
          ><MapIcon size={14} /></button>
          <button onClick={() => setShowSettings((v) => !v)} className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" title="Settings"><SettingsIcon size={14} /></button>
          {onReloadUI && (
            <button onClick={onReloadUI} className="flex items-center gap-1 rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600" title="Run be:reloadUI() in BeamNG">
              <RotateCcw size={12} /> Reload UI
            </button>
          )}
          <button
            onClick={() => void saveFile()}
            disabled={!openPath || !dirty || !activeRoot?.writable || saving}
            className="flex items-center gap-1 rounded bg-emerald-700 px-2 py-1 text-xs hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Save (Ctrl+S) — hot-loads in game, reverts on game exit unless committed"
          ><Save size={12} /> {saving ? 'Saving…' : 'Save'}</button>
          <button
            onClick={() => void commitCurrent()}
            disabled={!openPath || !uncommitted || dirty || committing}
            className="flex items-center gap-1 rounded bg-sky-700 px-2 py-1 text-xs hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-40"
            title="Commit current file — drops the backup, change becomes permanent"
          ><GitCommit size={12} /> {committing ? 'Committing…' : 'Commit'}</button>
          <button
            onClick={() => void revertCurrent()}
            disabled={!openPath || !uncommitted}
            className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-2 py-1 text-xs hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
            title="Revert current file to original on-disk content"
          ><Undo2 size={12} /> Revert</button>
        </div>
      </div>

      {showSettings && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-scrim-15)] px-3 py-2 text-xs backdrop-blur-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowInstall} onChange={(e) => setAllowInstall(e.target.checked)} />
            <span>Show BeamNG <code className="rounded bg-[var(--color-scrim-50)] px-1">install/ui</code> root (vanilla source)</span>
          </label>
          {allowInstall && (
            <label className="mt-1 flex items-center gap-2 pl-5">
              <input type="checkbox" checked={installWritable} onChange={(e) => setInstallWritable(e.target.checked)} />
              <span className="text-amber-300">Allow writes to install dir (will be clobbered by Steam updates)</span>
            </label>
          )}
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRevert}
              onChange={(e) => {
                const v = e.target.checked
                setAutoRevert(v)
                void window.api.beamUISetAutoRevert({ value: v }).catch(() => { /* ignore */ })
              }}
            />
            <span>Auto-revert uncommitted changes when game exits</span>
          </label>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => void saveAll()}
              disabled={dirtyCount === 0 || saving}
              className="rounded bg-emerald-800 px-2 py-1 text-zinc-100 hover:bg-emerald-700 disabled:opacity-40"
            >Save all dirty ({dirtyCount})</button>
            <button
              onClick={() => void commitAll()}
              disabled={uncommittedCount === 0 || committing}
              className="rounded bg-sky-800 px-2 py-1 text-zinc-100 hover:bg-sky-700 disabled:opacity-40"
            >Commit all ({uncommittedCount})</button>
            <button
              onClick={() => void revertAll()}
              disabled={uncommittedCount === 0}
              className="rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-2 py-1 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-40"
            >Revert all</button>
          </div>
          <p className="mt-2 text-zinc-500">
            Edit unpacked mods under <code className="rounded bg-[var(--color-scrim-50)] px-1">userDir/mods/unpacked/&lt;mod&gt;/ui</code> for changes that survive game updates. Run <code>be:reloadUI()</code> from the Lua tab (or the button above) to apply.
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div style={{ width: treeWidth }} className="flex flex-col border-r border-[var(--color-border)] bg-[var(--color-scrim-10)] backdrop-blur-sm">
          <div className="flex-1 overflow-auto p-1 text-xs">
            {tree ? (
              <TreeView
                node={tree}
                depth={0}
                rootId={activeRoot?.id ?? ''}
                onToggle={(n) => void expandFolder(n)}
                onOpen={(p) => void openFile(p)}
                openPath={openPath}
                openFiles={openFiles}
                stagedKeys={stagedKeys}
                dirtyFolders={dirtyFolders}
                stagedFolders={stagedFolders}
              />
            ) : roots.length === 0 ? (
              <div className="space-y-2 p-2 text-zinc-400">
                <div className="font-medium text-zinc-200">No UI roots found</div>
                <div>Checked locations:</div>
                <ul className="list-disc space-y-1 pl-4 text-[11px]">
                  <li>
                    <code className="text-zinc-300">{diag.userDir ?? '(userDir unknown)'}/ui</code>
                    <span className="text-zinc-500"> — appears only if it exists</span>
                  </li>
                  <li>
                    <code className="text-zinc-300">{diag.userDir ?? '(userDir unknown)'}/mods/unpacked/&lt;mod&gt;/ui</code>
                    <span className="text-zinc-500"> — one entry per unpacked mod with a ui folder</span>
                  </li>
                  <li>
                    <code className="text-zinc-300">{diag.installDir ?? '(installDir unknown)'}/ui</code>
                    <span className="text-zinc-500"> — only when toggled on in settings ⚙️</span>
                  </li>
                </ul>
                {!diag.userDir && !diag.installDir && (
                  <div className="text-amber-400">Game paths are not configured. Open Settings → Game Paths to set them.</div>
                )}
                <button onClick={() => void refreshRoots()} className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-2 py-1 text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]">Re-scan</button>
              </div>
            ) : (
              <div className="p-2 text-zinc-500">Select a root from the dropdown above</div>
            )}
          </div>
        </div>
        <div onMouseDown={onDragStart} className="w-1 cursor-col-resize bg-[var(--color-border)] hover:bg-[var(--color-accent)]" />
        <div className="flex min-w-0 flex-1 flex-col">
          {openFiles.size > 0 && (
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-scrim-10)] px-1 py-1 text-[11px] backdrop-blur-sm">
              {Array.from(openFiles.entries()).map(([key, f]) => {
                const fDirty = f.bufferContent !== f.savedContent
                const fStaged = stagedKeys.has(key)
                const isActive = key === currentKey
                return (
                  <div
                    key={key}
                    className={`group flex items-center gap-1 rounded px-2 py-0.5 ${isActive ? 'bg-[var(--color-scrim-15)] text-[var(--color-text-primary)]' : 'bg-[var(--color-scrim-10)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'}`}
                  >
                    <button
                      className="flex items-center gap-1 truncate"
                      onClick={() => { setActiveRootId(f.rootId); setOpenPath(f.path) }}
                      title={`${f.rootId}/${f.path}`}
                    >
                      {fDirty && <span className="text-amber-400">●</span>}
                      {!fDirty && fStaged && <span className="text-sky-400">◆</span>}
                      <span className="max-w-[160px] truncate">{f.path.split('/').pop()}</span>
                    </button>
                    <button
                      className="rounded px-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
                      onClick={() => closeBuffer(key)}
                      title="Close"
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
          {openPath ? (
            <>
              <div className="shrink-0 border-b border-zinc-800 px-3 py-1 text-xs text-zinc-400">
                <span className="text-zinc-200">{openPath}</span>
                {dirty && <span className="ml-2 text-amber-400">● unsaved</span>}
                {!dirty && uncommitted && <span className="ml-2 text-sky-400">◆ saved (uncommitted)</span>}
                {!activeRoot?.writable && <span className="ml-2 text-zinc-500">(read-only)</span>}
              </div>
              {isEditable ? (
                <div className="min-h-0 flex-1">
                  <Editor
                    language={currentFile?.language ?? langForFile(openPath)}
                    theme="beammp-devtools"
                    path={currentKey ?? undefined}
                    value={content}
                    onChange={(v) => setBuffer(v ?? '')}
                    onMount={handleEditorMount}
                    options={{
                      // Full IDE experience — this is where real file editing happens.
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
                      fontLigatures: true,
                      minimap: { enabled: minimap, renderCharacters: true, showSlider: 'mouseover' },
                      readOnly: !activeRoot?.writable || loading,
                      automaticLayout: true,
                      wordWrap: wordWrap ? 'on' : 'off',
                      tabSize: 2,
                      scrollBeyondLastLine: true,
                      renderWhitespace: 'selection',
                      bracketPairColorization: { enabled: true },
                      guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
                      smoothScrolling: true,
                      cursorBlinking: 'smooth',
                      cursorSmoothCaretAnimation: 'on',
                      padding: { top: 8 },
                      lineNumbersMinChars: 3,
                      folding: true,
                      foldingStrategy: 'indentation',
                      showFoldingControls: 'mouseover',
                      renderLineHighlight: 'all',
                      stickyScroll: { enabled: true },
                      suggest: { showKeywords: true, showSnippets: true, showWords: true },
                      quickSuggestions: { other: true, comments: false, strings: true },
                      suggestOnTriggerCharacters: true,
                      formatOnPaste: true,
                      formatOnType: false,
                      mouseWheelZoom: true,
                      multiCursorModifier: 'ctrlCmd',
                      linkedEditing: true,
                      occurrencesHighlight: 'singleFile',
                      matchBrackets: 'always',
                    }}
                  />
                </div>
              ) : preview?.kind === 'image' ? (
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[var(--color-scrim-50)] p-4">
                  <div className="flex flex-col items-center gap-2">
                    <img
                      src={preview.dataUrl}
                      alt={openPath}
                      className="max-h-full max-w-full rounded border border-[var(--color-border)] bg-[repeating-conic-gradient(#00000020_0_25%,transparent_0_50%)] bg-[length:16px_16px] object-contain shadow-lg"
                    />
                    <div className="text-[11px] text-[var(--color-text-muted)]">{(preview.size / 1024).toFixed(1)} KB</div>
                  </div>
                </div>
              ) : preview?.kind === 'binary' ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-zinc-500">
                  <div className="text-sm text-[var(--color-text-secondary)]">{preview.reason}</div>
                  {preview.size > 0 && <div className="text-xs">{(preview.size / 1024).toFixed(1)} KB</div>}
                  {activeRoot && (
                    <button
                      className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-3 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                      onClick={() => void window.api.beamUIRevealInExplorer({ rootId: activeRoot.id, subPath: openPath })}
                    >Reveal in Explorer</button>
                  )}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center text-zinc-500">Loading…</div>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
              Select a file from the tree to begin editing
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TreeView({ node, depth, rootId, onToggle, onOpen, openPath, openFiles, stagedKeys, dirtyFolders, stagedFolders }: { node: TreeNode; depth: number; rootId: string; onToggle: (n: TreeNode) => void; onOpen: (path: string) => void; openPath: string | null; openFiles: Map<string, OpenFileState>; stagedKeys: Set<string>; dirtyFolders: Set<string>; stagedFolders: Set<string> }): React.JSX.Element {
  const isRoot = depth === 0
  const key = rootId ? fileKey(rootId, node.path) : ''
  const buf = openFiles.get(key)
  const isDirty = !!buf && buf.bufferContent !== buf.savedContent
  const isStaged = stagedKeys.has(key)
  // For folders: show the marker if any descendant is dirty/staged. Stays visible
  // even when the folder is collapsed.
  const folderHasDirty = node.isDirectory && dirtyFolders.has(node.path)
  const folderHasStaged = node.isDirectory && stagedFolders.has(node.path)
  return (
    <div>
      {!isRoot && (
        <button
          className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-[var(--color-surface-hover)] ${openPath === node.path ? 'bg-[var(--color-scrim-15)] text-emerald-300' : ''}`}
          style={{ paddingLeft: depth * 10 }}
          onClick={() => (node.isDirectory ? onToggle(node) : onOpen(node.path))}
        >
          {node.isDirectory ? (node.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span className="w-3" />}
          {node.isDirectory ? <Folder size={12} className="text-amber-400" /> : <FileText size={12} className="text-zinc-400" />}
          <span className="truncate">{node.name}</span>
          {!node.isDirectory && isDirty && <span className="ml-auto text-amber-400" title="Unsaved buffer changes">●</span>}
          {!node.isDirectory && !isDirty && isStaged && <span className="ml-auto text-sky-400" title="Saved but not committed (will revert on game exit)">◆</span>}
          {node.isDirectory && folderHasDirty && <span className="ml-auto text-amber-400" title="Contains unsaved changes">●</span>}
          {node.isDirectory && !folderHasDirty && folderHasStaged && <span className="ml-auto text-sky-400" title="Contains uncommitted (staged) changes">◆</span>}
        </button>
      )}
      {(isRoot || node.expanded) && node.children && (
        <div>
          {node.children.map((c) => (
            <TreeView key={c.path} node={c} depth={depth + 1} rootId={rootId} onToggle={onToggle} onOpen={onOpen} openPath={openPath} openFiles={openFiles} stagedKeys={stagedKeys} dirtyFolders={dirtyFolders} stagedFolders={stagedFolders} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Project save/load/delete dropdown menu. */
function ProjectMenu({ open, onToggle, projects, activeProject, onSave, onLoad, onDelete }: {
  open: boolean
  onToggle: () => void
  projects: ProjectInfo[]
  activeProject: string | null
  onSave: (name: string) => void | Promise<void>
  onLoad: (name: string) => void | Promise<void>
  onDelete: (name: string) => void | Promise<void>
}): React.JSX.Element {
  const [name, setName] = useState<string>(activeProject ?? '')
  useEffect(() => { setName(activeProject ?? '') }, [activeProject])
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 rounded border border-[var(--color-border)] bg-[var(--color-scrim-15)] px-2 py-1 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
        title="Projects"
      >
        <FolderPlus size={12} /> Project{activeProject ? `: ${activeProject}` : 's'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded border border-[var(--color-border)] bg-[var(--color-scrim-40)] p-2 text-xs text-[var(--color-text-primary)] shadow-2xl backdrop-blur-md">
          <div className="mb-2 font-medium text-zinc-300">Save current staged files as project</div>
          <div className="flex gap-1">
            <input
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-scrim-50)] px-2 py-1 text-[var(--color-text-primary)]"
              placeholder="project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { void onSave(name.trim()) } }}
            />
            <button
              disabled={!name.trim()}
              onClick={() => { if (name.trim()) void onSave(name.trim()) }}
              className="rounded bg-emerald-700 px-2 py-1 hover:bg-emerald-600 disabled:opacity-40"
            >Save</button>
          </div>
          <div className="mt-3 mb-1 font-medium text-zinc-300">Saved projects ({projects.length})</div>
          {projects.length === 0 && <div className="text-zinc-500">No projects yet.</div>}
          <div className="max-h-64 overflow-auto">
            {projects.map((p) => (
              <div key={p.name} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--color-surface-hover)]">
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => void onLoad(p.name)}
                  title={`Load — ${p.fileCount} files, saved ${new Date(p.savedAt).toLocaleString()}`}
                >
                  <span className={p.name === activeProject ? 'text-emerald-300' : 'text-zinc-200'}>{p.name}</span>
                  <span className="ml-2 text-zinc-500">{p.fileCount} files</span>
                </button>
                <button
                  className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-red-400"
                  onClick={() => void onDelete(p.name)}
                  title="Delete project"
                ><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
