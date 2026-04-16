import { useState, useEffect, useCallback } from 'react'
import { Save, Upload, Download, Trash2, FolderOpen, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useControlsStore } from '../../stores/useControlsStore'

export function PresetManager(): React.JSX.Element {
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

  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [confirmLoad, setConfirmLoad] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  useEffect(() => {
    loadPresets()
  }, [])

  const handleSave = useCallback(async () => {
    if (!presetName.trim()) return
    await savePreset(presetName.trim())
    setPresetName('')
    setShowSaveDialog(false)
  }, [presetName, savePreset])

  const handleLoad = useCallback(
    async (presetId: string) => {
      await applyPreset(presetId)
      setConfirmLoad(null)
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

      // Trigger download via a blob
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

  if (!selectedDevice) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
        {t('controls.noDevice')}
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowSaveDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-accent)] text-[var(--color-text-primary)] hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          <Plus size={12} />
          {t('controls.presetSave')}
        </button>
        <button
          onClick={handleImport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <Upload size={12} />
          {t('controls.presetImport')}
        </button>
      </div>

      {/* Preset list */}
      {presets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Save size={48} className="text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">{t('controls.presetEmpty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center gap-3 px-4 py-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-surface)] group"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {preset.name}
                </div>
                <div className="text-[10px] text-[var(--color-text-muted)]">
                  {new Date(preset.createdAt).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setConfirmLoad(preset.id)}
                  title={t('controls.presetLoad')}
                  className="p-1.5 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                >
                  <FolderOpen size={14} />
                </button>
                <button
                  onClick={() => handleExport(preset.id)}
                  title={t('controls.presetExport')}
                  className="p-1.5 rounded hover:bg-[var(--color-accent-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-colors"
                >
                  <Download size={14} />
                </button>
                <button
                  onClick={() => setConfirmDelete(preset.id)}
                  title={t('controls.presetDelete')}
                  className="p-1.5 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save dialog */}
      {showSaveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
          onClick={() => setShowSaveDialog(false)}
        >
          <div
            className="glass-raised w-80 p-5 rounded-lg flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
              {t('controls.presetSave')}
            </h3>
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder={t('controls.presetName')}
              className="w-full px-3 py-2 text-xs bg-[var(--color-scrim-20)] border border-[var(--color-border)] rounded-md text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/50"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
                if (e.key === 'Escape') setShowSaveDialog(false)
              }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('controls.conflictCancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={!presetName.trim()}
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
    </div>
  )
}
