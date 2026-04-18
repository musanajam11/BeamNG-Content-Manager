import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Trash2,
  Upload,
  Folder,
  File,
  ChevronRight,
  Search,
  FolderPlus,
  Copy,
  X,
  RefreshCw,
  Archive,
  Check,
  FolderOpen,
  Pencil,
  Files,
  Download,
  FileArchive,
  ExternalLink,
  Loader2,
  CornerUpLeft
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ServerFileEntry, ServerFileSearchResult } from '../../../../shared/types'
import { FileEditor } from './FileEditor'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { useToastStore } from '../../stores/useToastStore'

const EDITABLE_EXTS = new Set([
  '.lua', '.json', '.toml', '.cfg', '.ini', '.txt', '.md', '.xml',
  '.yaml', '.yml', '.html', '.css', '.js', '.ts', '.py', '.sh',
  '.bat', '.ps1', '.log', '.csv', '.conf', '.properties'
])

function isEditable(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return EDITABLE_EXTS.has(name.slice(dot).toLowerCase())
}

function isZip(name: string): boolean {
  return name.toLowerCase().endsWith('.zip')
}

interface FilesPanelProps {
  serverId: string
  files: ServerFileEntry[]
  filePath: string
  onNavigate: (sub: string) => void
  onRefresh: () => void
}

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`
  return `${(b / 1073741824).toFixed(1)} GB`
}

function formatDate(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const now = Date.now()
  const diff = now - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString()
}

interface ContextState {
  x: number
  y: number
  file: ServerFileEntry
}

interface SearchState {
  query: string
  recursive: boolean
  loading: boolean
  results: ServerFileSearchResult[]
}

export function FilesPanel({
  serverId,
  files,
  filePath,
  onNavigate,
  onRefresh
}: FilesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [search, setSearch] = useState<SearchState>({
    query: '',
    recursive: false,
    loading: false,
    results: []
  })
  const [copied, setCopied] = useState<string | null>(null)
  const [editingFile, setEditingFile] = useState<ServerFileEntry | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [renaming, setRenaming] = useState<{ path: string; name: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ServerFileEntry | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  // Reset transient state on path / server change (derived-state pattern)
  const navKey = `${serverId}|${filePath}`
  const [lastNavKey, setLastNavKey] = useState(navKey)
  if (lastNavKey !== navKey) {
    setLastNavKey(navKey)
    setSearch({ query: '', recursive: search.recursive, loading: false, results: [] })
    setRenaming(null)
    setConfirmDelete(null)
  }

  // Recursive search (debounced)
  useEffect(() => {
    if (!search.recursive || !search.query.trim()) {
      return
    }
    let cancelled = false
    const handle = setTimeout(async () => {
      setSearch((s) => ({ ...s, loading: true }))
      try {
        const results = await window.api.hostedServerSearchFiles(
          serverId,
          filePath,
          search.query.trim()
        )
        if (!cancelled) setSearch((s) => ({ ...s, loading: false, results }))
      } catch (err) {
        if (!cancelled) {
          setSearch((s) => ({ ...s, loading: false, results: [] }))
          addToast(t('serverManager.actionFailed', { error: String(err) }), 'error')
        }
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [search.recursive, search.query, serverId, filePath, addToast, t])

  const localSorted = useMemo(() => {
    return [...files].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [files])

  const localFiltered = useMemo(() => {
    if (search.recursive || !search.query.trim()) return localSorted
    const q = search.query.toLowerCase()
    return localSorted.filter((f) => f.name.toLowerCase().includes(q))
  }, [localSorted, search.query, search.recursive])

  if (editingFile) {
    return (
      <FileEditor
        serverId={serverId}
        filePath={editingFile.path}
        fileName={editingFile.name}
        onClose={() => { setEditingFile(null); onRefresh() }}
      />
    )
  }

  const wrap = async (
    label: string,
    fn: () => Promise<void>,
    successMsg?: string
  ): Promise<void> => {
    try {
      await fn()
      if (successMsg) addToast(successMsg, 'success')
    } catch (err) {
      addToast(`${label}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const doDelete = async (f: ServerFileEntry): Promise<void> => {
    setConfirmDelete(null)
    setBusyPath(f.path)
    await wrap(
      t('serverManager.ctxDelete'),
      async () => {
        await window.api.hostedServerDeleteFile(serverId, f.path)
        onRefresh()
      },
      t('serverManager.deleteSuccess', { name: f.name })
    )
    setBusyPath(null)
  }

  const doExtract = async (f: ServerFileEntry): Promise<void> => {
    setBusyPath(f.path)
    await wrap(t('serverManager.ctxUnzip'), async () => {
      const r = await window.api.hostedServerExtractZip(serverId, f.path)
      addToast(t('serverManager.extractSuccess', { count: r.extracted }), 'success')
      onRefresh()
    })
    setBusyPath(null)
  }

  const doZip = async (f: ServerFileEntry): Promise<void> => {
    setBusyPath(f.path)
    await wrap(t('serverManager.ctxZip'), async () => {
      const r = await window.api.hostedServerZipEntry(serverId, f.path)
      const name = r.path.split('/').pop() ?? r.path
      addToast(t('serverManager.zipCreated', { name }), 'success')
      onRefresh()
    })
    setBusyPath(null)
  }

  const doDuplicate = async (f: ServerFileEntry): Promise<void> => {
    setBusyPath(f.path)
    await wrap(t('serverManager.ctxDuplicate'), async () => {
      const newPath = await window.api.hostedServerDuplicateFile(serverId, f.path)
      const name = newPath.split('/').pop() ?? newPath
      addToast(t('serverManager.duplicateCreated', { name }), 'success')
      onRefresh()
    })
    setBusyPath(null)
  }

  const doDownload = async (f: ServerFileEntry): Promise<void> => {
    setBusyPath(f.path)
    await wrap(t('serverManager.ctxDownload'), async () => {
      const r = await window.api.hostedServerDownloadEntry(serverId, f.path)
      if (r.canceled) {
        addToast(t('serverManager.downloadCanceled'), 'info')
      } else if (r.success && r.path) {
        addToast(t('serverManager.downloadStarted', { path: r.path }), 'success')
      }
    })
    setBusyPath(null)
  }

  const doReveal = async (f: ServerFileEntry): Promise<void> => {
    await wrap(t('serverManager.ctxOpenInExplorer'), async () => {
      await window.api.hostedServerRevealInExplorer(serverId, f.path)
    })
  }

  const doOpenExternal = async (f: ServerFileEntry): Promise<void> => {
    await wrap(t('serverManager.ctxOpen'), async () => {
      await window.api.hostedServerOpenEntry(serverId, f.path)
    })
  }

  const startRename = (f: ServerFileEntry): void => {
    setRenaming({ path: f.path, name: f.name })
  }

  const commitRename = async (): Promise<void> => {
    if (!renaming) return
    const trimmed = renaming.name.trim()
    const oldName = renaming.path.split('/').pop()
    if (!trimmed || trimmed === oldName) {
      setRenaming(null)
      return
    }
    const oldPath = renaming.path
    setRenaming(null)
    setBusyPath(oldPath)
    await wrap(t('serverManager.ctxRename'), async () => {
      await window.api.hostedServerRenameFile(serverId, oldPath, trimmed)
      addToast(t('serverManager.renameSuccess', { name: trimmed }), 'success')
      onRefresh()
    })
    setBusyPath(null)
  }

  const handleAddFiles = async (): Promise<void> => {
    await wrap(t('serverManager.addFiles'), async () => {
      const added = await window.api.hostedServerAddFiles(serverId, filePath)
      if (added.length > 0) onRefresh()
    })
  }

  const handleNewFolder = (): void => {
    setCreatingFolder(true)
    setNewFolderName('')
  }

  const handleNewFolderConfirm = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) {
      setCreatingFolder(false)
      return
    }
    const sub = filePath ? `${filePath}/${name}` : name
    await wrap(t('serverManager.newFolder'), async () => {
      await window.api.hostedServerCreateFolder(serverId, sub)
      onRefresh()
    })
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const handleNewFolderCancel = (): void => {
    setCreatingFolder(false)
    setNewFolderName('')
  }

  const copyPath = (path: string): void => {
    navigator.clipboard.writeText(path)
    setCopied(path)
    setTimeout(() => setCopied(null), 1500)
  }

  const openContext = (e: React.MouseEvent, file: ServerFileEntry): void => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, file })
  }

  const buildMenu = (f: ServerFileEntry): ContextMenuItem[] => {
    const items: ContextMenuItem[] = []
    if (f.isDirectory) {
      items.push({
        key: 'open',
        label: t('serverManager.ctxOpen'),
        icon: FolderOpen,
        onSelect: () => onNavigate(f.path)
      })
    } else if (isEditable(f.name)) {
      items.push({
        key: 'open',
        label: t('serverManager.ctxOpen'),
        icon: FolderOpen,
        onSelect: () => setEditingFile(f)
      })
    } else {
      items.push({
        key: 'open-ext',
        label: t('serverManager.ctxOpen'),
        icon: ExternalLink,
        onSelect: () => doOpenExternal(f)
      })
    }
    items.push({
      key: 'reveal',
      label: t('serverManager.ctxOpenInExplorer'),
      icon: ExternalLink,
      onSelect: () => doReveal(f)
    })
    items.push({
      key: 'rename',
      label: t('serverManager.ctxRename'),
      icon: Pencil,
      separatorAbove: true,
      onSelect: () => startRename(f)
    })
    items.push({
      key: 'duplicate',
      label: t('serverManager.ctxDuplicate'),
      icon: Files,
      onSelect: () => doDuplicate(f)
    })
    items.push({
      key: 'download',
      label: t('serverManager.ctxDownload'),
      icon: Download,
      onSelect: () => doDownload(f)
    })
    items.push({
      key: 'zip',
      label: t('serverManager.ctxZip'),
      icon: FileArchive,
      separatorAbove: true,
      onSelect: () => doZip(f)
    })
    if (!f.isDirectory && isZip(f.name)) {
      items.push({
        key: 'unzip',
        label: t('serverManager.ctxUnzip'),
        icon: Archive,
        onSelect: () => doExtract(f)
      })
    }
    items.push({
      key: 'copy-path',
      label: t('serverManager.ctxCopyPath'),
      icon: Copy,
      separatorAbove: true,
      onSelect: () => copyPath(f.path)
    })
    items.push({
      key: 'delete',
      label: t('serverManager.ctxDelete'),
      icon: Trash2,
      danger: true,
      separatorAbove: true,
      onSelect: () => setConfirmDelete(f)
    })
    return items
  }

  // Drag & drop upload
  const onDragEnter = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragCounter.current++
    setDragOver(true)
  }
  const onDragLeave = (e: React.DragEvent): void => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }
  const onDragOver = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length === 0) return
    const sourcePaths: string[] = []
    for (const f of dropped) {
      try {
        const p = window.api.getPathForFile(f)
        if (p) sourcePaths.push(p)
      } catch {
        // ignore
      }
    }
    if (sourcePaths.length === 0) return
    await wrap(t('serverManager.addFiles'), async () => {
      const added = await window.api.hostedServerUploadFiles(serverId, filePath, sourcePaths)
      if (added.length > 0) {
        onRefresh()
        addToast(`${added.length} file(s) uploaded`, 'success')
      }
    })
  }

  const breadcrumbs = filePath ? filePath.split('/') : []

  const showingResults = search.recursive && search.query.trim().length > 0
  const dirCount = files.filter((f) => f.isDirectory).length
  const fileCount = files.length - dirCount
  const renderRow = (f: ServerFileEntry, parentLabel?: string): React.JSX.Element => {
    const isRenaming = renaming?.path === f.path
    const isBusy = busyPath === f.path
    const isConfirming = confirmDelete?.path === f.path
    return (
      <div
        key={f.path}
        onContextMenu={(e) => openContext(e, f)}
        onDoubleClick={() => {
          if (f.isDirectory) onNavigate(f.path)
          else if (isEditable(f.name)) setEditingFile(f)
          else doOpenExternal(f)
        }}
        className={`flex items-center gap-2 w-full px-4 py-1.5 text-sm border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] group ${
          isBusy ? 'opacity-60' : ''
        }`}
      >
        {f.isDirectory ? (
          <Folder size={14} className="text-[var(--color-accent)] shrink-0" />
        ) : (
          <File size={14} className="shrink-0 text-[var(--color-text-secondary)]" />
        )}
        {isRenaming && renaming ? (
          <input
            autoFocus
            value={renaming.name}
            onFocus={(e) => {
              const dot = f.name.lastIndexOf('.')
              if (!f.isDirectory && dot > 0) {
                e.currentTarget.setSelectionRange(0, dot)
              } else {
                e.currentTarget.select()
              }
            }}
            onChange={(e) => setRenaming({ path: renaming.path, name: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') setRenaming(null)
            }}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 text-sm bg-[var(--color-bg)] border border-[var(--color-accent)] rounded px-2 py-0.5 text-[var(--color-text-primary)] outline-none"
          />
        ) : f.isDirectory ? (
          <button
            onClick={() => onNavigate(f.path)}
            className="flex items-center gap-2 flex-1 min-w-0 text-left text-[var(--color-text-primary)]"
            title={f.path}
          >
            <span className="truncate">{f.name}</span>
            {parentLabel && (
              <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-1">
                {t('serverManager.in')} /{parentLabel}
              </span>
            )}
          </button>
        ) : (
          <button
            onClick={() => isEditable(f.name) ? setEditingFile(f) : doOpenExternal(f)}
            className={`flex items-center gap-2 flex-1 min-w-0 text-left ${
              isEditable(f.name)
                ? 'text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-accent)]'
                : 'text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-accent)]'
            }`}
            title={isEditable(f.name) ? t('serverManager.clickToEdit') : f.path}
          >
            <span className="truncate">{f.name}</span>
            {parentLabel && (
              <span className="text-[10px] text-[var(--color-text-muted)] shrink-0 ml-1">
                {t('serverManager.in')} /{parentLabel}
              </span>
            )}
          </button>
        )}

        <span className="w-20 text-right text-xs text-[var(--color-text-muted)] shrink-0">
          {f.isDirectory ? '—' : formatSize(f.size)}
        </span>
        <span className="w-24 text-right text-xs text-[var(--color-text-muted)] shrink-0 hidden md:inline-block">
          {formatDate(f.modified)}
        </span>

        <div className="w-24 flex items-center justify-end gap-0.5 shrink-0">
          {isBusy && <Loader2 size={12} className="animate-spin text-[var(--color-accent)]" />}
          {!f.isDirectory && isZip(f.name) && !isBusy && (
            <button
              onClick={() => doExtract(f)}
              className="p-1 rounded transition-all opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
              title={t('serverManager.extractHere')}
            >
              <Archive size={12} />
            </button>
          )}
          {!isBusy && (
            <button
              onClick={() => copyPath(f.path)}
              className={`p-1 rounded transition-all ${
                copied === f.path
                  ? 'text-green-400'
                  : 'opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
              title={t('serverManager.copyPath')}
            >
              <Copy size={12} />
            </button>
          )}
          {isConfirming ? (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => doDelete(f)}
                className="px-1.5 py-0.5 text-[10px] bg-red-500 text-[var(--color-text-primary)] rounded hover:bg-red-600 transition-colors"
              >
                {t('serverManager.deleteConfirmYes')}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                {t('serverManager.deleteConfirmNo')}
              </button>
            </div>
          ) : (
            !isBusy && (
              <button
                onClick={() => setConfirmDelete(f)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-red-400 transition-all"
                title={t('serverManager.deleteFile')}
              >
                <Trash2 size={12} />
              </button>
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="flex items-center gap-1 text-xs min-w-0 overflow-hidden">
          <button
            onClick={() => onNavigate('')}
            className="text-[var(--color-accent)] hover:underline shrink-0 font-medium"
          >
            {t('serverManager.fileRoot')}
          </button>
          {breadcrumbs.map((seg, i) => {
            const path = breadcrumbs.slice(0, i + 1).join('/')
            return (
              <span key={i} className="flex items-center gap-1 shrink-0">
                <ChevronRight size={10} className="text-[var(--color-text-muted)]" />
                <button
                  onClick={() => onNavigate(path)}
                  className="text-[var(--color-accent)] hover:underline"
                >
                  {seg}
                </button>
              </span>
            )
          })}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onRefresh}
            className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title={t('serverManager.fileRefresh')}
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleNewFolder}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <FolderPlus size={12} /> {t('serverManager.newFolder')}
          </button>
          <button
            onClick={handleAddFiles}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:opacity-90 transition-colors"
          >
            <Upload size={12} /> {t('serverManager.addFiles')}
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--color-border)]">
        <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
        <input
          type="text"
          value={search.query}
          onChange={(e) => setSearch((s) => ({ ...s, query: e.target.value }))}
          placeholder={search.recursive ? t('serverManager.searchAllFolders') : t('serverManager.searchInFolder')}
          className="flex-1 text-xs bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
        />
        <button
          onClick={() => setSearch((s) => ({ ...s, recursive: !s.recursive, results: [] }))}
          className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
            search.recursive
              ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-text-primary)]'
              : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
          }`}
          title={t('serverManager.searchAllFolders')}
        >
          {t('serverManager.searchAllFolders')}
        </button>
        {search.query && (
          <button
            onClick={() => setSearch((s) => ({ ...s, query: '', results: [] }))}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            title={t('serverManager.searchClear')}
          >
            <X size={12} />
          </button>
        )}
        {showingResults ? (
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
            {search.loading
              ? t('serverManager.searching')
              : t('serverManager.searchResults', { count: search.results.length })}
          </span>
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
            {t('serverManager.folderCount', { count: dirCount })}, {t('serverManager.fileCount', { count: fileCount })}
          </span>
        )}
      </div>

      {/* Column header */}
      <div className="flex items-center px-4 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <span className="flex-1">{t('serverManager.fileName')}</span>
        <span className="w-20 text-right">{t('serverManager.fileSize')}</span>
        <span className="w-24 text-right hidden md:inline-block">{t('serverManager.fileModified')}</span>
        <span className="w-24 text-right">{t('serverManager.fileActions')}</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto" onContextMenu={(e) => e.preventDefault()}>
        {filePath && !showingResults && (
          <button
            onClick={() => {
              const parts = filePath.split('/')
              parts.pop()
              onNavigate(parts.join('/'))
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border)]"
          >
            <CornerUpLeft size={14} /> ..
          </button>
        )}
        {creatingFolder && !showingResults && (
          <div className="flex items-center gap-2 w-full px-4 py-1.5 text-sm border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
            <FolderPlus size={14} className="text-[var(--color-accent)] shrink-0" />
            <input
              autoFocus
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNewFolderConfirm()
                if (e.key === 'Escape') handleNewFolderCancel()
              }}
              onBlur={() => { if (!newFolderName.trim()) handleNewFolderCancel() }}
              placeholder={t('serverManager.folderNamePrompt')}
              className="flex-1 min-w-0 text-sm bg-[var(--color-bg)] border border-[var(--color-accent)] rounded px-2 py-0.5 text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
            />
            <button
              onClick={handleNewFolderConfirm}
              className="p-1 rounded text-green-400 hover:text-green-300 transition-colors"
              title={t('serverManager.confirmDialogConfirm')}
            >
              <Check size={14} />
            </button>
            <button
              onClick={handleNewFolderCancel}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
              title={t('serverManager.confirmDialogCancel')}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {showingResults
          ? search.results.map((r) => renderRow(r, r.parentPath || undefined))
          : localFiltered.map((f) => renderRow(f))}
        {((showingResults && !search.loading && search.results.length === 0) ||
          (!showingResults && localFiltered.length === 0)) && (
          <div className="text-[var(--color-text-muted)] text-center py-8 text-sm">
            {search.query ? t('serverManager.noMatchingFiles') : t('serverManager.emptyFolder')}
          </div>
        )}
      </div>

      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-accent)]/10 border-2 border-dashed border-[var(--color-accent)] pointer-events-none">
          <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--color-surface)] border border-[var(--color-accent)] text-sm text-[var(--color-text-primary)] shadow-lg">
            <Upload size={16} className="text-[var(--color-accent)]" />
            {t('serverManager.dropToUpload')}
          </div>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenu(contextMenu.file)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
