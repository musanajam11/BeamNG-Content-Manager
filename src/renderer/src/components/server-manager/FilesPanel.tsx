import { useState, useRef, useEffect } from 'react'
import { Trash2, Upload, Folder, File, ChevronRight, Search, FolderPlus, Copy, X, RefreshCw, Archive, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ServerFileEntry } from '../../../../shared/types'
import { FileEditor } from './FileEditor'

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

export function FilesPanel({
  serverId,
  files,
  filePath,
  onNavigate,
  onRefresh
}: FilesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [editingFile, setEditingFile] = useState<ServerFileEntry | null>(null)
  const [extracting, setExtracting] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const newFolderInputRef = useRef<HTMLInputElement>(null)

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

  const handleDelete = async (f: ServerFileEntry): Promise<void> => {
    setDeleteTarget(null)
    await window.api.hostedServerDeleteFile(serverId, f.path)
    onRefresh()
  }

  const handleExtract = async (f: ServerFileEntry): Promise<void> => {
    setExtracting(f.path)
    try {
      await window.api.hostedServerExtractZip(serverId, f.path)
      onRefresh()
    } finally {
      setExtracting(null)
    }
  }

  const handleAddFiles = async (): Promise<void> => {
    await window.api.hostedServerAddFiles(serverId, filePath)
    onRefresh()
  }

  const handleNewFolder = (): void => {
    setCreatingFolder(true)
    setNewFolderName('')
    setTimeout(() => newFolderInputRef.current?.focus(), 0)
  }

  const handleNewFolderConfirm = async (): Promise<void> => {
    const name = newFolderName.trim()
    if (!name) {
      setCreatingFolder(false)
      return
    }
    const sub = filePath ? `${filePath}/${name}` : name
    await window.api.hostedServerCreateFolder(serverId, sub)
    setCreatingFolder(false)
    setNewFolderName('')
    onRefresh()
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

  const breadcrumbs = filePath ? filePath.split('/') : []

  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  const filtered = search
    ? sorted.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : sorted

  const dirCount = files.filter((f) => f.isDirectory).length
  const fileCount = files.length - dirCount

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        {/* Breadcrumbs */}
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
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[var(--color-accent)] text-white hover:opacity-90 transition-colors"
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
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('serverManager.searchFiles')}
          className="flex-1 text-xs bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
        />
        {search && (
          <button onClick={() => setSearch('')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
            <X size={12} />
          </button>
        )}
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
          {t('serverManager.folderCount', { count: dirCount })}, {t('serverManager.fileCount', { count: fileCount })}
        </span>
      </div>

      {/* Column header */}
      <div className="flex items-center px-4 py-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <span className="flex-1">{t('serverManager.fileName')}</span>
        <span className="w-20 text-right">{t('serverManager.fileSize')}</span>
        <span className="w-20 text-right">{t('serverManager.fileActions')}</span>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {filePath && (
          <button
            onClick={() => {
              const parts = filePath.split('/')
              parts.pop()
              onNavigate(parts.join('/'))
            }}
            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] border-b border-[var(--color-border)]"
          >
            <Folder size={14} /> ..
          </button>
        )}
        {creatingFolder && (
          <div className="flex items-center gap-2 w-full px-4 py-1.5 text-sm border-b border-[var(--color-border)] bg-[var(--color-surface-hover)]">
            <FolderPlus size={14} className="text-[var(--color-accent)] shrink-0" />
            <input
              ref={newFolderInputRef}
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
        {filtered.map((f) => (
          <div
            key={f.path}
            className="flex items-center gap-2 w-full px-4 py-1.5 text-sm border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] group"
          >
            {f.isDirectory ? (
              <button
                onClick={() => onNavigate(f.path)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left text-[var(--color-text-primary)]"
              >
                <Folder size={14} className="text-[var(--color-accent)] shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            ) : (
              <button
                onClick={() => isEditable(f.name) ? setEditingFile(f) : undefined}
                className={`flex items-center gap-2 flex-1 min-w-0 text-left ${isEditable(f.name) ? 'text-[var(--color-text-primary)] cursor-pointer hover:text-[var(--color-accent)]' : 'text-[var(--color-text-secondary)] cursor-default'}`}
                title={isEditable(f.name) ? 'Click to edit' : undefined}
              >
                <File size={14} className="shrink-0" />
                <span className="truncate">{f.name}</span>
              </button>
            )}

            <span className="w-20 text-right text-xs text-[var(--color-text-muted)] shrink-0">
              {f.isDirectory ? '—' : formatSize(f.size)}
            </span>

            <div className="w-20 flex items-center justify-end gap-0.5 shrink-0">
              {!f.isDirectory && f.name.toLowerCase().endsWith('.zip') && (
                <button
                  onClick={() => handleExtract(f)}
                  disabled={extracting === f.path}
                  className={`p-1 rounded transition-all ${
                    extracting === f.path
                      ? 'text-[var(--color-accent)] animate-pulse'
                      : 'opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-accent)]'
                  }`}
                  title={t('serverManager.extractHere')}
                >
                  <Archive size={12} />
                </button>
              )}
              <button
                onClick={() => copyPath(f.path)}
                className={`p-1 rounded transition-all ${copied === f.path ? 'text-green-400' : 'opacity-0 group-hover:opacity-100 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                title={t('serverManager.copyPath')}
              >
                <Copy size={12} />
              </button>
              {deleteTarget === f.path ? (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => handleDelete(f)}
                    className="px-1.5 py-0.5 text-[10px] bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                  >
                    {t('serverManager.deleteConfirmYes')}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(null)}
                    className="px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                  >
                    {t('serverManager.deleteConfirmNo')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteTarget(f.path)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-red-400 transition-all"
                  title="Delete"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="text-[var(--color-text-muted)] text-center py-8 text-sm">
            {search ? t('serverManager.noMatchingFiles') : t('serverManager.emptyFolder')}
          </div>
        )}
      </div>
    </div>
  )
}
