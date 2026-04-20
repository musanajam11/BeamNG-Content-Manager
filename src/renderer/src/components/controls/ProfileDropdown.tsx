import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, Save, FolderOpen, Trash2, Upload, Download } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useControlsStore } from '../../stores/useControlsStore'

export function ProfileDropdown(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    presets,
    selectedDevice,
    loadPresets,
    savePreset,
    applyPreset,
    deletePreset,
    exportPreset,
    importPreset
  } = useControlsStore()

  const [open, setOpen] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadPresets()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSave = useCallback(async () => {
    if (!saveName.trim()) return
    await savePreset(saveName.trim())
    setSaveName('')
    setShowSave(false)
  }, [saveName, savePreset])

  const handleLoad = useCallback(
    async (presetId: string) => {
      await applyPreset(presetId)
      setConfirmLoad(null)
      setOpen(false)
    },
    [applyPreset]
  )

  const handleDelete = useCallback(
    async (presetId: string) => {
      await deletePreset(presetId)
      setConfirmDelete(null)
    },
    [deletePreset]
  )

  const handleExport = useCallback(
    async (presetId: string) => {
      const preset = await exportPreset(presetId)
      if (!preset) return
      const json = JSON.stringify(preset, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${preset.name.replace(/[^a-zA-Z0-9-_]/g, '_')}.beamcontrols`
      a.click()
      URL.revokeObjectURL(url)
    },
    [exportPreset]
  )

  const handleImport = useCallback(async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.beamcontrols,.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const text = await file.text()
      await importPreset(text)
    }
    input.click()
  }, [importPreset])

  if (!selectedDevice) return <></>

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <FolderOpen size={12} />
          {t('controls.profiles')}
          <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-72 z-50 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] shadow-lg overflow-hidden">
            {/* Header actions */}
            <div className="flex items-center gap-1 p-2 border-b border-[var(--color-border)]">
              <button
                onClick={() => {
                  setShowSave(true)
                  setOpen(false)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                <Save size={10} />
                {t('controls.profileSaveCurrent')}
              </button>
              <button
                onClick={() => {
                  handleImport()
                  setOpen(false)
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium rounded bg-[var(--color-surface)] text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <Upload size={10} />
                {t('controls.presetImport')}
              </button>
            </div>

            {/* Preset list */}
            {presets.length === 0 ? (
              <div className="px-3 py-4 text-center text-[10px] text-[var(--color-text-muted)]">
                {t('controls.profileNone')}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-surface-hover)] group transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                        {preset.name}
                      </div>
                      <div className="text-[9px] text-[var(--color-text-muted)]">
                        {preset.deviceName && (
                          <span className="mr-2">{preset.deviceName}</span>
                        )}
                        {new Date(preset.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmLoad(preset.id)
                          setOpen(false)
                        }}
                        title={t('controls.presetLoad')}
                        className="p-1 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        <FolderOpen size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleExport(preset.id)
                        }}
                        title={t('controls.presetExport')}
                        className="p-1 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                      >
                        <Download size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmDelete(preset.id)
                          setOpen(false)
                        }}
                        title={t('controls.presetDelete')}
                        className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Save dialog */}
      {showSave && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
          onClick={() => setShowSave(false)}
        >
          <div
            className="glass-raised w-80 p-5 rounded-lg flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('controls.profileSaveTitle')}
            </h3>
            <p className="text-[10px] text-[var(--color-text-muted)]">
              {t('controls.profileSaveDesc')}
            </p>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t('controls.presetName')}
              className="w-full px-3 py-2 text-xs bg-[var(--color-scrim-20)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setShowSave(false)
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSave(false)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('controls.conflictCancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-[var(--color-accent)] rounded-md hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-40"
              >
                <Save size={12} className="inline mr-1" />
                {t('controls.presetSave')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Load confirmation */}
      {confirmLoad && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
          onClick={() => setConfirmLoad(null)}
        >
          <div
            className="glass-raised w-80 p-5 rounded-lg flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('controls.presetLoadConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmLoad(null)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('controls.conflictCancel')}
              </button>
              <button
                onClick={() => handleLoad(confirmLoad)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-[var(--color-accent)] rounded-md hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                {t('controls.presetLoad')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="glass-raised w-80 p-5 rounded-lg flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('controls.presetDeleteConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('controls.conflictCancel')}
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-red-500 rounded-md hover:bg-red-600 transition-colors"
              >
                {t('controls.presetDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
