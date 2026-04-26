import { useEffect, useCallback, useMemo, useState, useRef } from 'react'
import { Trash2, AlertTriangle, Upload, X, ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { HostedServerConfig } from '../../../../shared/types'
import { BeamMPNameEditor } from './BeamMPNameEditor'
import { CareerMPConfigSection } from './CareerMPConfigSection'
import { DynamicTrafficConfigSection } from './DynamicTrafficConfigSection'
import { ModGateConfigSection } from './ModGateConfigSection'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'

type MapEntry = { name: string; source: 'stock' | 'mod'; levelDir?: string; modZipPath?: string; previewImage?: string | null }

interface ConfigEditorProps {
  draft: Partial<HostedServerConfig>
  setDraft: (d: Partial<HostedServerConfig>) => void
  onSave: () => void
  onDelete: () => void
  saving: boolean
  serverId: string
}

interface ValidationError {
  field: string
  message: string
}

function validate(draft: Partial<HostedServerConfig>): ValidationError[] {
  const errors: ValidationError[] = []
  if (!draft.name?.trim()) errors.push({ field: 'name', message: 'Server name is required' })
  if (!draft.port || draft.port < 1024 || draft.port > 65535) errors.push({ field: 'port', message: 'Port must be 1024–65535' })
  if (!draft.authKey?.trim()) errors.push({ field: 'authKey', message: 'Auth key is required' })
  if (!draft.maxPlayers || draft.maxPlayers < 1 || draft.maxPlayers > 200) errors.push({ field: 'maxPlayers', message: 'Max players must be 1–200' })
  if (!draft.maxCars || draft.maxCars < 1 || draft.maxCars > 200) errors.push({ field: 'maxCars', message: 'Max cars must be 1–200' })
  if (!draft.map?.trim()) errors.push({ field: 'map', message: 'Map is required' })
  return errors
}

const formatMapName = (name: string): string =>
  name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function ConfigEditor({
  draft,
  setDraft,
  onSave,
  onDelete,
  saving,
  serverId
}: ConfigEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const errors = useMemo(() => validate(draft), [draft])
  const errorMap = useMemo(() => new Map(errors.map((e) => [e.field, e.message])), [errors])
  const hasErrors = errors.length > 0

  const { dialog: deployMapDialog, confirm: confirmDeployMap } = useConfirmDialog()
  const [deployingMapMod, setDeployingMapMod] = useState(false)
  const [deployMapMsg, setDeployMapMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [customImage, setCustomImage] = useState<string | null>(null)
  const [mapPreview, setMapPreview] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [mapList, setMapList] = useState<MapEntry[]>([])

  // Load available maps
  useEffect(() => {
    window.api.listMaps().then((maps) => setMapList(maps))
  }, [])

  // Fetch map thumbnail for the currently selected map (used as banner fallback).
  // For mod maps, use the previewImage already extracted by ModManagerService
  // (the same icon shown in the Mods page). Fall back to getMapPreview only
  // for stock maps or mod maps whose previewImage is null.
  useEffect(() => {
    let cancelled = false
    setMapPreview(null)
    if (mapList.length === 0 || !draft.map) return
    const entry = mapList.find((m) => `/levels/${m.levelDir || m.name}/info.json` === draft.map)
    if (!entry) return
    // Use already-extracted mod icon if available
    if (entry.previewImage) {
      setMapPreview(entry.previewImage)
      return
    }
    const levelPath = `/levels/${entry.levelDir || entry.name}/`
    window.api.getMapPreview(levelPath, entry.modZipPath).then((img) => {
      if (!cancelled) setMapPreview(img ?? null)
    })
    return () => { cancelled = true }
  }, [draft.map, mapList])

  const handleMapChange = useCallback(async (newValue: string) => {
    setDeployMapMsg(null)

    // ── 1. Undeploy previous mod map if switching away from one ──
    const prevValue = draft.map ?? ''
    const prevEntry = mapList.find((m) => `/levels/${m.levelDir || m.name}/info.json` === prevValue)
    if (prevEntry && prevEntry.source === 'mod' && prevEntry.modZipPath) {
      const prevFileName = prevEntry.modZipPath.replace(/\\/g, '/').split('/').pop() ?? ''
      try {
        const deployed = await window.api.hostedServerDeployedMods(serverId)
        if (deployed.some((f) => f.toLowerCase() === prevFileName.toLowerCase())) {
          await window.api.hostedServerUndeployMod(serverId, prevFileName)
        }
      } catch { /* ignore — cleanup is best-effort */ }
    }

    // ── 2. Apply new map value ────────────────────────────────────
    setDraft({ ...draft, map: newValue })

    // ── 3. Offer to deploy new mod map if it isn't yet deployed ──
    const entry = mapList.find((m) => `/levels/${m.levelDir || m.name}/info.json` === newValue)
    if (!entry || entry.source !== 'mod' || !entry.modZipPath) return
    const zipPath = entry.modZipPath
    const fileName = zipPath.replace(/\\/g, '/').split('/').pop() ?? ''
    let alreadyDeployed = false
    try {
      const deployed = await window.api.hostedServerDeployedMods(serverId)
      alreadyDeployed = deployed.some((f) => f.toLowerCase() === fileName.toLowerCase())
    } catch { /* ignore */ }
    if (alreadyDeployed) return
    const yes = await confirmDeployMap({
      title: 'Deploy map mod to server?',
      message: `"${entry.name}" is a modded map. Deploy "${fileName}" to this server's Resources/Client so players can download it?`,
      confirmLabel: 'Deploy',
      cancelLabel: 'Skip',
      variant: 'default'
    })
    if (!yes) return
    setDeployingMapMod(true)
    try {
      await window.api.hostedServerCopyMod(serverId, zipPath)
      setDeployMapMsg({ ok: true, text: `"${fileName}" deployed to server.` })
    } catch (err) {
      setDeployMapMsg({ ok: false, text: `Deploy failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setDeployingMapMod(false)
    }
  }, [draft, setDraft, mapList, serverId, confirmDeployMap])

  // Load existing custom image on mount
  useEffect(() => {
    window.api.hostedServerGetCustomImage(serverId).then((img) => {
      setCustomImage(img)
    })
  }, [serverId])

  const handleImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setUploadingImage(true)
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })
      const saved = await window.api.hostedServerSaveCustomImage(serverId, dataUrl)
      setCustomImage(saved)
      setDraft({ ...draft, customImage: 'custom-banner' })
    } finally {
      setUploadingImage(false)
    }
  }, [serverId, draft, setDraft])

  const removeImage = useCallback(async () => {
    await window.api.hostedServerRemoveCustomImage(serverId)
    setCustomImage(null)
    setDraft({ ...draft, customImage: undefined })
  }, [serverId, draft, setDraft])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleImageFile(file)
  }, [handleImageFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragging(false), [])

  const handleSave = useCallback(() => {
    if (!hasErrors) onSave()
  }, [hasErrors, onSave])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const field = (
    label: string,
    key: keyof HostedServerConfig,
    type: 'text' | 'number' | 'password' = 'text'
  ): React.JSX.Element => {
    const err = errorMap.get(key)
    return (
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
        <input
          type={type}
          value={(draft[key] as string | number) ?? ''}
          onChange={(e) =>
            setDraft({
              ...draft,
              [key]: type === 'number' ? parseInt(e.target.value) || 0 : e.target.value
            })
          }
          className={`px-2 py-1.5 text-sm bg-[var(--color-surface)] border text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-accent)] outline-none rounded ${err ? 'border-red-500/60' : 'border-[var(--color-border)]'}`}
        />
        {err && <span className="text-[11px] text-red-400">{err}</span>}
      </label>
    )
  }

  const toggle = (label: string, key: keyof HostedServerConfig): React.JSX.Element => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={!!draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
        className="accent-[var(--color-accent)]"
      />
      <span className="text-sm text-[var(--color-text-secondary)]">{label}</span>
    </label>
  )

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 w-full">
        <BeamMPNameEditor
          value={(draft.name as string) ?? ''}
          onChange={(name) => setDraft({ ...draft, name })}
          error={errorMap.get('name')}
        />
        {field(t('serverManager.configPort'), 'port', 'number')}
        {field(t('serverManager.configAuthKey'), 'authKey', 'password')}
        {field(t('serverManager.configMaxPlayers'), 'maxPlayers', 'number')}
        {field(t('serverManager.configMaxCarsPerPlayer'), 'maxCars', 'number')}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">{t('serverManager.configMap')}</span>
          <select
            value={draft.map ?? ''}
            onChange={(e) => { void handleMapChange(e.target.value) }}
            className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] focus:border-[var(--color-border-accent)] outline-none rounded"
          >
            <option value="" disabled>{t('serverManager.selectMap')}</option>
            {mapList.map((m) => {
              // For mod maps, use the actual level directory name; for stock maps, use the name
              const dirName = m.levelDir || m.name
              const val = `/levels/${dirName}/info.json`
              return (
                <option key={val} value={val}>
                  {formatMapName(m.name)}{m.source === 'mod' ? ' (mod)' : ''}
                </option>
              )
            })}
          </select>
          {deployingMapMod && (
            <span className="text-xs text-[var(--color-text-muted)]">Deploying map mod...</span>
          )}
          {deployMapMsg && (
            <span className={`text-xs ${deployMapMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{deployMapMsg.text}</span>
          )}
        </label>
        {field(t('serverManager.configTags'), 'tags')}
        {field(t('serverManager.configResourceFolder'), 'resourceFolder')}
        <div className="col-span-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-text-muted)]">{t('serverManager.configDescription')}</span>
            <textarea
              value={draft.description ?? ''}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              className="px-2 py-1.5 text-sm bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-border-accent)] outline-none resize-none rounded"
            />
          </label>
        </div>
        <div className="col-span-2 flex flex-wrap gap-4">
          {toggle(t('serverManager.configPrivate'), 'private')}
          {toggle(t('serverManager.configAllowGuests'), 'allowGuests')}
          {toggle(t('serverManager.configLogChat'), 'logChat')}
          {toggle(t('serverManager.configDebug'), 'debug')}
        </div>

        {/* Custom Banner Image */}
        <div className="col-span-2">
          <span className="text-xs text-[var(--color-text-muted)] mb-1 block">{t('serverManager.configServerCardImage')}</span>
          {customImage ? (
            <div className="relative rounded border border-[var(--color-border)] overflow-hidden">
              <img src={customImage} alt="Custom banner" className="w-full h-32 object-cover" />
              <div className="absolute top-2 right-2 flex gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 bg-[var(--color-scrim-60)] hover:bg-[var(--color-scrim-80)] text-[var(--color-text-primary)] rounded transition-colors"
                  title={t('serverManager.replaceImage')}
                >
                  <Upload size={12} />
                </button>
                <button
                  onClick={removeImage}
                  className="p-1.5 bg-[var(--color-scrim-60)] hover:bg-red-600/80 text-[var(--color-text-primary)] rounded transition-colors"
                  title={t('serverManager.removeImage')}
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          ) : mapPreview ? (
            /* No custom image — show map thumbnail as preview with upload overlay */
            <div
              className="relative rounded border border-[var(--color-border)] overflow-hidden cursor-pointer group"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <img src={mapPreview} alt="Map preview" className="w-full h-32 object-cover" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-[var(--color-scrim-60)] opacity-0 group-hover:opacity-100 transition-opacity">
                <Upload size={16} className="text-[var(--color-text-primary)]" />
                <span className="text-[11px] text-[var(--color-text-primary)]">{t('serverManager.configDragOrClick')}</span>
              </div>
              <div className="absolute bottom-1.5 left-2">
                <span className="text-[10px] text-white/70 bg-black/40 px-1.5 py-0.5 rounded">Map preview</span>
              </div>
            </div>
          ) : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 h-28 border-2 border-dashed rounded cursor-pointer transition-colors ${
                dragging
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/5'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-accent)] bg-[var(--color-surface)]'
              }`}
            >
              {uploadingImage ? (
                <span className="text-xs text-[var(--color-text-muted)]">Uploading...</span>
              ) : (
                <>
                  <ImageIcon size={20} className="text-[var(--color-text-muted)]" />
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {t('serverManager.configDragOrClick')}
                  </span>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    Used as the card banner — defaults to map preview if not set
                  </span>
                </>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImageFile(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {/* Validation summary */}
      {hasErrors && (
        <div className="mt-4 flex items-start gap-2 p-3 rounded border border-yellow-500/30 bg-yellow-500/5 w-full">
          <AlertTriangle size={16} className="text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-xs text-yellow-300 space-y-0.5">
            {errors.map((e) => (
              <div key={e.field}>{e.message}</div>
            ))}
          </div>
        </div>
      )}

      {/* CareerMP plugin config — only renders when CareerMP is installed for this server */}
      <CareerMPConfigSection serverId={serverId} />

      {/* BeamMP Dynamic Traffic plugin config — only renders when that plugin is installed for this server */}
      <DynamicTrafficConfigSection serverId={serverId} />

      {/* Vehicle allow/block checklist backing sideload protection enforcement */}
      <ModGateConfigSection
        serverId={serverId}
        enabled={!!draft.clientContentGate}
        onToggleEnabled={async (enabled) => {
          const previous = !!draft.clientContentGate
          const nextDraft = { ...draft, clientContentGate: enabled }
          setDraft(nextDraft)
          try {
            await window.api.hostedServerUpdate(serverId, { clientContentGate: enabled })
          } catch (err) {
            setDraft({ ...draft, clientContentGate: previous })
            throw err
          }
        }}
      />

      {deployMapDialog}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || hasErrors}
          className="px-4 py-2 text-sm font-semibold rounded bg-[var(--color-accent)] text-black hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
          title={hasErrors ? 'Fix validation errors first' : 'Save (Ctrl+S)'}
        >
          {saving ? t('serverManager.configSaving') : t('serverManager.configSaveConfiguration')}
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 size={14} />
          {t('serverManager.configDeleteServer')}
        </button>
      </div>
    </div>
  )
}
