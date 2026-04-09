import { Keyboard, Gamepad2, Disc3, MousePointer, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InputDevice, InputDeviceType } from '../../../../shared/types'

const deviceTypeIcon: Record<InputDeviceType, React.ElementType> = {
  keyboard: Keyboard,
  mouse: MousePointer,
  xinput: Gamepad2,
  joystick: Disc3
}

interface DeviceSelectorProps {
  devices: InputDevice[]
  selectedDevice: string | null
  onSelect: (fileName: string) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

export function DeviceSelector({
  devices,
  selectedDevice,
  onSelect,
  collapsed,
  onToggleCollapse
}: DeviceSelectorProps): React.JSX.Element {
  const { t } = useTranslation()

  const grouped = devices.reduce<Record<InputDeviceType, InputDevice[]>>(
    (acc, d) => {
      if (!acc[d.devicetype]) acc[d.devicetype] = []
      acc[d.devicetype].push(d)
      return acc
    },
    {} as Record<InputDeviceType, InputDevice[]>
  )

  const groupOrder: InputDeviceType[] = ['keyboard', 'mouse', 'xinput', 'joystick']

  return (
    <div
      className={`flex flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-all ${collapsed ? 'w-12' : 'w-56'}`}
    >
      <button
        onClick={onToggleCollapse}
        className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] transition-colors border-b border-[var(--color-border)]"
      >
        {collapsed ? (
          <ChevronRight size={14} />
        ) : (
          <>
            <ChevronDown size={14} />
            <span>{t('controls.devices')}</span>
          </>
        )}
      </button>

      <div className="flex-1 overflow-y-auto">
        {groupOrder.map((type) => {
          const group = grouped[type]
          if (!group || group.length === 0) return null
          const Icon = deviceTypeIcon[type]

          return (
            <div key={type}>
              {!collapsed && (
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {t(`controls.deviceType_${type}`)}
                </div>
              )}

              {group.map((device) => {
                const isActive = device.fileName === selectedDevice
                return (
                  <button
                    key={device.fileName}
                    onClick={() => onSelect(device.fileName)}
                    title={collapsed ? device.name : undefined}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                      isActive
                        ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border-r-2 border-[var(--color-accent)]'
                        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <Icon size={14} className="shrink-0" />
                    {!collapsed && (
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{device.name}</div>
                        {device.vendorName && (
                          <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                            {device.vendorName}
                          </div>
                        )}
                      </div>
                    )}
                    {!collapsed && device.hasUserOverrides && (
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
