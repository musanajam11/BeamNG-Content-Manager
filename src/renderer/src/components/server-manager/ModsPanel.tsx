import { Package, Server, Trash2, GripVertical } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'
import { useTranslation } from 'react-i18next'
import { AdminToolsPanel } from './AdminToolsPanel'

interface ModItem {
  key: string
  name: string
  active: boolean
  filePath: string
  multiplayerScope?: string | null
}

interface ModsPanelProps {
  serverId: string
  mods: ModItem[]
  onRefresh: () => void
}

function SortableServerModRow({
  mod,
  isDeployed,
  hasServerComponent,
  isCopying,
  isUndeploying,
  onCopy,
  onUndeploy,
  t
}: {
  mod: ModItem
  isDeployed: boolean
  hasServerComponent: boolean
  isCopying: boolean
  isUndeploying: boolean
  onCopy: (filePath: string) => void
  onUndeploy: (fileName: string) => void
  t: (key: string, opts?: Record<string, unknown>) => string
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: mod.key })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined
  }

  const fileName = mod.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
    >
      {/* Drag handle */}
      {isDeployed && (
        <button
          {...attributes}
          {...listeners}
          className="text-[var(--color-text-dim)] hover:text-[var(--color-text-secondary)] cursor-grab active:cursor-grabbing touch-none"
        >
          <GripVertical size={14} />
        </button>
      )}
      {!isDeployed && <div className="w-[14px]" />}

      <Package
        size={14}
        className={isDeployed ? 'text-green-400' : 'text-[var(--color-text-muted)]'}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-[var(--color-text-primary)] truncate">{mod.name}</span>
          {hasServerComponent && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-purple-300 bg-purple-400/10 border border-purple-400/20 shrink-0">
              <Server size={10} />{t('serverManager.clientServer')}
            </span>
          )}
        </div>
        <div className="text-[11px] text-[var(--color-text-muted)] truncate">{mod.key}</div>
      </div>
      <span
        className={`text-[11px] px-1.5 py-0.5 ${
          isDeployed
            ? 'text-green-400 bg-green-400/10'
            : 'text-[var(--color-text-muted)] bg-[var(--color-surface)]'
        }`}
      >
        {isDeployed ? t('serverManager.deployed') : t('serverManager.notDeployed')}
      </span>
      <button
        onClick={() => onCopy(mod.filePath)}
        disabled={isCopying}
        className="text-xs px-2.5 py-1 bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/30 transition-colors disabled:opacity-50"
      >
        {isCopying ? t('serverManager.deploying') : isDeployed ? t('serverManager.redeploy') : hasServerComponent ? t('serverManager.deployToServer') : t('serverManager.copyToServer')}
      </button>
      {isDeployed && (
        <button
          onClick={() => onUndeploy(fileName)}
          disabled={isUndeploying}
          className="text-xs px-2 py-1 text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition-colors disabled:opacity-50"
          title={t('serverManager.removeModFromServer')}
        >
          {isUndeploying ? (
            t('serverManager.removing')
          ) : (
            <Trash2 size={12} />
          )}
        </button>
      )}
    </div>
  )
}

export function ModsPanel({ serverId, mods, onRefresh }: ModsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [registryMeta, setRegistryMeta] = useState<Record<string, { multiplayer_scope?: string }>>({})
  const [copying, setCopying] = useState<string | null>(null)
  const [undeploying, setUndeploying] = useState<string | null>(null)
  const [deployedNames, setDeployedNames] = useState<Set<string>>(new Set())
  const [deployedOrder, setDeployedOrder] = useState<string[]>([])
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchDeployed = async (): Promise<void> => {
    try {
      const names = await window.api.hostedServerDeployedMods(serverId)
      setDeployedNames(new Set(names))
    } catch { /* not critical */ }
  }

  const fetchOrder = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.hostedServerGetModLoadOrder(serverId)
      if (result.success && result.data) {
        const sorted = Object.entries(result.data.orders)
          .sort(([, a], [, b]) => (a as number) - (b as number))
          .map(([key]) => key)
        setDeployedOrder(sorted)
      }
    } catch { /* not critical */ }
  }, [serverId])

  useEffect(() => {
    fetchDeployed()
    fetchOrder()
  }, [serverId, fetchOrder])

  useEffect(() => {
    window.api.registryGetInstalled().then((installed) => {
      const meta: Record<string, { multiplayer_scope?: string }> = {}
      for (const [, entry] of Object.entries(installed)) {
        const scope = (entry as { metadata?: { multiplayer_scope?: string } }).metadata?.multiplayer_scope
        const files = (entry as { installed_files?: string[] }).installed_files ?? []
        for (const f of files) {
          const normName = f.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
          meta[normName] = { multiplayer_scope: scope }
        }
      }
      setRegistryMeta(meta)
    }).catch(() => { /* not critical */ })
  }, [mods])

  const getScope = (mod: { filePath: string; multiplayerScope?: string | null }): string | undefined => {
    // Prefer manual classification from ModInfo
    if (mod.multiplayerScope) return mod.multiplayerScope
    // Fall back to registry metadata
    const fileName = mod.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    return registryMeta[fileName]?.multiplayer_scope
  }

  const handleCopy = async (modFilePath: string): Promise<void> => {
    setCopying(modFilePath)
    try {
      await window.api.hostedServerCopyMod(serverId, modFilePath)
      await fetchDeployed()
      await fetchOrder()
      onRefresh()
    } finally {
      setCopying(null)
    }
  }

  const handleUndeploy = async (fileName: string): Promise<void> => {
    const ok = await confirm({
      title: t('serverManager.undeployMod'),
      message: t('serverManager.undeployModMessage', { fileName }),
      confirmLabel: t('serverManager.undeployLabel'),
      variant: 'danger'
    })
    if (!ok) return
    setUndeploying(fileName)
    try {
      await window.api.hostedServerUndeployMod(serverId, fileName)
      await fetchDeployed()
      await fetchOrder()
      onRefresh()
    } finally {
      setUndeploying(null)
    }
  }

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const deployedMods = sortedMods.filter((m) => {
      const fn = m.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
      return deployedNames.has(fn)
    })
    const oldIndex = deployedMods.findIndex((m) => m.key === active.id)
    const newIndex = deployedMods.findIndex((m) => m.key === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(deployedMods, oldIndex, newIndex)
    const orderedKeys = reordered.map((m) => m.key)
    setDeployedOrder(orderedKeys)
    window.api.hostedServerSetModLoadOrder(serverId, orderedKeys).catch(() => {})
  }

  // Sort mods: deployed first (by load order), then non-deployed
  const sortedMods = [...mods].sort((a, b) => {
    const fnA = a.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    const fnB = b.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    const deployedA = deployedNames.has(fnA)
    const deployedB = deployedNames.has(fnB)
    if (deployedA !== deployedB) return deployedA ? -1 : 1
    if (deployedA && deployedB) {
      const orderA = deployedOrder.indexOf(a.key)
      const orderB = deployedOrder.indexOf(b.key)
      return (orderA === -1 ? 999 : orderA) - (orderB === -1 ? 999 : orderB)
    }
    return a.name.localeCompare(b.name)
  })

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          {t('serverManager.deployModsDescription')}
        </div>
      <div className="flex-1 overflow-y-auto">
        {mods.length === 0 ? (
          <div className="text-[var(--color-text-muted)] text-center py-8 text-sm">
            {t('serverManager.noModsInstalled')}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={sortedMods.filter((m) => {
                const fn = m.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
                return deployedNames.has(fn)
              }).map((m) => m.key)}
              strategy={verticalListSortingStrategy}
            >
              {sortedMods.map((m) => {
                const scope = getScope(m)
                const hasServerComponent = scope === 'both' || scope === 'server'
                const fileName = m.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
                const isDeployed = deployedNames.has(fileName)
                return (
                  <SortableServerModRow
                    key={m.key}
                    mod={m}
                    isDeployed={isDeployed}
                    hasServerComponent={hasServerComponent}
                    isCopying={copying === m.filePath}
                    isUndeploying={undeploying === fileName}
                    onCopy={handleCopy}
                    onUndeploy={handleUndeploy}
                    t={t}
                  />
                )
              })}
            </SortableContext>
          </DndContext>
        )}
      </div>
      </div>
      <AdminToolsPanel serverId={serverId} />
      {confirmDialogEl}
    </>
  )
}
