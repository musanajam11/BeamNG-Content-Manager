import { useState, useEffect, useMemo, useCallback } from 'react'
import { Search, Loader2, AlertTriangle, RotateCcw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useControlsStore } from '../stores/useControlsStore'
import { DeviceSelector } from '../components/controls/DeviceSelector'
import { BindingCategory } from '../components/controls/BindingCategory'
import { BindingCaptureModal } from '../components/controls/BindingCaptureModal'
import { ConflictDialog } from '../components/controls/ConflictDialog'
import { AxisConfigPanel } from '../components/controls/AxisConfigPanel'
import { FFBSettingsPanel } from '../components/controls/FFBSettingsPanel'
import { LiveInputPanel } from '../components/controls/LiveInputPanel'
import { PresetManager } from '../components/controls/PresetManager'
import { ProfileDropdown } from '../components/controls/ProfileDropdown'
import { SteeringFilterPanel } from '../components/controls/SteeringFilterPanel'
import type { ControlsTab, InputAction, InputBinding, BindingConflict, ConflictResolution, InputDeviceType, FFBConfig } from '../../../shared/types'

const TABS: { id: ControlsTab; labelKey: string }[] = [
  { id: 'bindings', labelKey: 'controls.tabBindings' },
  { id: 'axes', labelKey: 'controls.tabAxes' },
  { id: 'ffb', labelKey: 'controls.tabFFB' },
  { id: 'filters', labelKey: 'controls.tabFilters' },
  { id: 'presets', labelKey: 'controls.tabPresets' },
  { id: 'liveInput', labelKey: 'controls.tabLiveInput' }
]

export function ControlsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    devices,
    actions,
    categories,
    selectedDevice,
    bindings,
    tab,
    search,
    loading,
    error,
    refresh,
    selectDevice,
    setTab,
    setSearch,
    setBinding,
    removeBinding,
    resetDevice,
    getConflicts,
    setFFBConfig
  } = useControlsStore()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Capture modal state
  const [captureTarget, setCaptureTarget] = useState<InputAction | null>(null)
  // Conflict dialog state
  const [conflict, setConflict] = useState<{ conflict: BindingConflict; pendingControl: string; pendingAction: string } | null>(null)
  // Reset confirmation
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Load data on mount
  useEffect(() => {
    refresh()
  }, [])

  // Auto-select first device
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      selectDevice(devices[0].fileName)
    }
  }, [devices, selectedDevice])

  // Auto-expand first category when bindings load
  useEffect(() => {
    if (categories.length > 0 && expandedCategories.size === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time init
      setExpandedCategories(new Set([categories[0].id]))
    }
  }, [categories])

  const searchLower = search.toLowerCase()

  // Group actions by category
  const actionsByCategory = useMemo(() => {
    const map = new Map<string, typeof actions>()
    for (const action of actions) {
      const list = map.get(action.cat) || []
      list.push(action)
      map.set(action.cat, list)
    }
    return map
  }, [actions])

  const toggleCategory = (catId: string): void => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  // Get the selected device's type for capture modal
  const selectedDeviceObj = devices.find((d) => d.fileName === selectedDevice)
  const deviceType: InputDeviceType = selectedDeviceObj?.devicetype ?? 'keyboard'

  // Handle edit: open capture modal
  const handleEdit = useCallback((action: InputAction) => {
    setCaptureTarget(action)
  }, [])

  // Handle clear: remove a binding
  const handleClear = useCallback(
    async (control: string, actionId: string) => {
      await removeBinding(control, actionId)
    },
    [removeBinding]
  )

  // Handle capture: check for conflicts, then set binding
  const handleCapture = useCallback(
    async (control: string) => {
      if (!captureTarget) return
      setCaptureTarget(null)

      const existing = getConflicts(control, captureTarget.id)
      if (existing && existing.existingActions.length > 0) {
        setConflict({ conflict: existing, pendingControl: control, pendingAction: captureTarget.id })
        return
      }

      await setBinding({ control, action: captureTarget.id, isUserOverride: true })
    },
    [captureTarget, getConflicts, setBinding]
  )

  // Handle conflict resolution
  const handleConflictResolve = useCallback(
    async (resolution: ConflictResolution) => {
      if (!conflict) return
      const { pendingControl, pendingAction, conflict: conflictData } = conflict
      setConflict(null)

      if (resolution === 'cancel') return

      if (resolution === 'replace') {
        // Remove old bindings for this control, then set new
        for (const oldAction of conflictData.existingActions) {
          await removeBinding(pendingControl, oldAction)
        }
        await setBinding({ control: pendingControl, action: pendingAction, isUserOverride: true })
      } else if (resolution === 'bindBoth') {
        // Keep existing and also bind new
        await setBinding({ control: pendingControl, action: pendingAction, isUserOverride: true })
      } else if (resolution === 'swap') {
        // Find current binding for the pending action, swap controls
        const currentBindingsForAction = bindings.filter(
          (b) => b.action === pendingAction && !b.isRemoved
        )
        const oldControl = currentBindingsForAction[0]?.control

        // Remove old bindings from both sides
        for (const oldAction of conflictData.existingActions) {
          await removeBinding(pendingControl, oldAction)
        }
        if (oldControl) {
          await removeBinding(oldControl, pendingAction)
        }

        // Set new binding
        await setBinding({ control: pendingControl, action: pendingAction, isUserOverride: true })

        // Swap: assign old control to the first conflicting action
        if (oldControl && conflictData.existingActions[0]) {
          await setBinding({ control: oldControl, action: conflictData.existingActions[0], isUserOverride: true })
        }
      }
    },
    [conflict, removeBinding, setBinding, bindings]
  )

  // Handle reset device
  const handleReset = useCallback(async () => {
    setShowResetConfirm(false)
    await resetDevice()
  }, [resetDevice])

  // Handle axis binding updates
  const handleAxisUpdate = useCallback(
    async (binding: Partial<InputBinding> & { control: string; action: string }) => {
      await setBinding({
        ...binding,
        isUserOverride: true
      } as InputBinding)
    },
    [setBinding]
  )

  // Handle FFB config updates
  const handleFFBUpdate = useCallback(
    async (config: Partial<FFBConfig>) => {
      // Find the first FFB-capable binding for the selected device
      const ffbBinding = bindings.find((b) => b.ffb || b.isForceEnabled)
      if (!ffbBinding) return
      const currentFFB: FFBConfig = ffbBinding.ffb ?? {
        forceCoef: 100,
        smoothing: 0,
        smoothing2: 0,
        smoothing2automatic: true,
        lowspeedCoef: false,
        responseCorrected: true,
        responseCurve: [[0, 0], [1, 1]],
        updateType: 0
      }
      await setFFBConfig(ffbBinding.control, { ...currentFFB, ...config })
    },
    [bindings, setFFBConfig]
  )

  // Get current FFB config from the first FFB-capable binding
  const currentFFBConfig = useMemo(() => {
    const ffbBinding = bindings.find((b) => b.ffb || b.isForceEnabled)
    return ffbBinding?.ffb ?? null
  }, [bindings])

  // No game paths configured
  const noGamePaths = devices.length === 0 && !loading && !error

  return (
    <div className="flex h-full overflow-hidden">
      {/* Device sidebar */}
      <DeviceSelector
        devices={devices}
        selectedDevice={selectedDevice}
        onSelect={selectDevice}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {TABS.map((tabDef) => (
              <button
                key={tabDef.id}
                onClick={() => setTab(tabDef.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === tabDef.id
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-transparent'
                }`}
              >
                {t(tabDef.labelKey)}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Reset button */}
          {tab === 'bindings' && selectedDevice && (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-red-400 border border-[var(--color-border)] rounded-md hover:border-red-400/30 transition-colors"
            >
              <RotateCcw size={12} />
              {t('controls.resetDevice')}
            </button>
          )}

          {/* Profiles dropdown */}
          {tab === 'bindings' && <ProfileDropdown />}

          {/* Search */}
          {tab === 'bindings' && (
            <div className="relative">
              <Search
                size={14}
                className="absolute top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none"
                style={{ left: 14 }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('controls.searchBindings')}
                className="w-52 pr-3 py-1.5 text-xs bg-[var(--color-scrim-20)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)]/50"
                style={{ paddingLeft: 38 }}
              />
            </div>
          )}
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-full gap-2 text-[var(--color-text-muted)]">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">{t('controls.loading')}</span>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full gap-2 text-red-400">
              <AlertTriangle size={20} />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {noGamePaths && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Settings2 size={48} className="text-[var(--color-text-muted)] opacity-40" />
              <p className="text-sm text-[var(--color-text-muted)]">
                {t('controls.noGamePaths')}
              </p>
            </div>
          )}

          {!loading && !error && !noGamePaths && tab === 'bindings' && (
            <div className="space-y-2 max-w-4xl">
              {selectedDevice && bindings.length === 0 && (
                <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">
                  {t('controls.noBindings')}
                </div>
              )}

              {categories.map((cat) => {
                const catActions = actionsByCategory.get(cat.id) || []
                if (catActions.length === 0) return null

                return (
                  <BindingCategory
                    key={cat.id}
                    categoryId={cat.id}
                    categoryName={cat.name}
                    actions={catActions}
                    bindings={bindings}
                    expanded={expandedCategories.has(cat.id)}
                    onToggle={() => toggleCategory(cat.id)}
                    search={searchLower}
                    onEdit={handleEdit}
                    onClear={handleClear}
                  />
                )
              })}
            </div>
          )}

          {!loading && !error && !noGamePaths && tab === 'axes' && (
            <AxisConfigPanel
              bindings={bindings}
              actions={actions}
              onUpdateBinding={handleAxisUpdate}
            />
          )}

          {!loading && !error && !noGamePaths && tab === 'ffb' && (
            <FFBSettingsPanel
              ffbConfig={currentFFBConfig}
              onUpdate={handleFFBUpdate}
            />
          )}

          {!loading && !error && !noGamePaths && tab === 'filters' && (
            <SteeringFilterPanel />
          )}

          {!loading && !error && !noGamePaths && tab === 'presets' && (
            <PresetManager />
          )}

          {!loading && !error && !noGamePaths && tab === 'liveInput' && (
            <LiveInputPanel deviceType={deviceType} deviceName={selectedDeviceObj?.name} />
          )}
        </div>
      </div>

      {/* Binding capture modal */}
      {captureTarget && (
        <BindingCaptureModal
          actionName={
            captureTarget.title.startsWith('ui.')
              ? captureTarget.id
                  .replace(/([A-Z])/g, ' $1')
                  .replace(/_/g, ' ')
                  .replace(/^\w/, (c) => c.toUpperCase())
                  .trim()
              : captureTarget.title
          }
          deviceType={deviceType}
          onCapture={handleCapture}
          onCancel={() => setCaptureTarget(null)}
        />
      )}

      {/* Conflict resolution dialog */}
      {conflict && (
        <ConflictDialog conflict={conflict.conflict} onResolve={handleConflictResolve} />
      )}

      {/* Reset confirmation dialog */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="glass-raised w-80 p-5 rounded-lg flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[var(--color-text-secondary)]">
              {t('controls.resetConfirm')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                {t('controls.conflictCancel')}
              </button>
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-red-500 rounded-md hover:bg-red-600 transition-colors"
              >
                {t('controls.resetDevice')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
