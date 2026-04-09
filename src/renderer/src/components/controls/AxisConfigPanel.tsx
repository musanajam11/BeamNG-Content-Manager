import { useState, useMemo } from 'react'
import { Sliders, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getControlDisplayName } from '../../../../shared/controlNameMaps'
import type { InputBinding, InputAction } from '../../../../shared/types'

interface AxisConfigPanelProps {
  bindings: InputBinding[]
  actions: InputAction[]
  onUpdateBinding: (binding: Partial<InputBinding> & { control: string; action: string }) => void
}

export function AxisConfigPanel({
  bindings,
  actions,
  onUpdateBinding
}: AxisConfigPanelProps): React.JSX.Element {
  const { t } = useTranslation()

  // Filter to only axis-like bindings (those with linearity, deadzone, or centered actions)
  const axisBindings = useMemo(() => {
    const centeredActions = new Set(actions.filter((a) => a.isCentered).map((a) => a.id))
    return bindings.filter(
      (b) =>
        !b.isRemoved &&
        (b.linearity !== undefined ||
          b.deadzone !== undefined ||
          b.deadzoneEnd !== undefined ||
          centeredActions.has(b.action))
    )
  }, [bindings, actions])

  if (axisBindings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
        <Sliders size={48} className="text-[var(--color-text-muted)] opacity-40" />
        <p className="text-sm text-[var(--color-text-muted)]">{t('controls.noAxes')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3 max-w-4xl">
      {axisBindings.map((binding) => (
        <AxisRow
          key={`${binding.control}::${binding.action}`}
          binding={binding}
          actions={actions}
          onUpdate={onUpdateBinding}
        />
      ))}
    </div>
  )
}

interface AxisRowProps {
  binding: InputBinding
  actions: InputAction[]
  onUpdate: (binding: Partial<InputBinding> & { control: string; action: string }) => void
}

function AxisRow({ binding, actions, onUpdate }: AxisRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const action = actions.find((a) => a.id === binding.action)
  const actionName = action?.title.startsWith('ui.') ? binding.action : (action?.title ?? binding.action)

  const linearity = binding.linearity ?? 1.0
  const deadzone = (binding.deadzone ?? 0) * 100
  const deadzoneEnd = (binding.deadzoneEnd ?? 1) * 100
  const isInverted = binding.isInverted ?? false
  const angle = binding.angle ?? 0

  const handleChange = (field: string, value: number | boolean): void => {
    onUpdate({
      control: binding.control,
      action: binding.action,
      [field]: value
    })
  }

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            {actionName}
          </span>
          <span className="text-[10px] font-mono text-[var(--color-text-muted)] px-1.5 py-0.5 bg-black/20 rounded">
            {getControlDisplayName(binding.control)}
          </span>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={isInverted}
            onChange={(e) => handleChange('isInverted', e.target.checked)}
            className="rounded-full"
          />
          {t('controls.axisInvert')}
        </label>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-3 gap-4">
        <SliderField
          label={t('controls.axisLinearity')}
          value={linearity}
          min={0.2}
          max={5.0}
          step={0.1}
          displayValue={linearity.toFixed(1)}
          onChange={(v) => handleChange('linearity', v)}
        />
        <SliderField
          label={t('controls.axisDeadzone')}
          value={deadzone}
          min={0}
          max={50}
          step={1}
          displayValue={`${deadzone.toFixed(0)}%`}
          onChange={(v) => handleChange('deadzone', v / 100)}
        />
        <SliderField
          label={t('controls.axisDeadzoneEnd')}
          value={deadzoneEnd}
          min={50}
          max={100}
          step={1}
          displayValue={`${deadzoneEnd.toFixed(0)}%`}
          onChange={(v) => handleChange('deadzoneEnd', v / 100)}
        />
      </div>

      {/* Steering angle (if applicable) */}
      {angle > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <SliderField
            label={t('controls.axisSteeringAngle')}
            value={angle}
            min={90}
            max={1080}
            step={10}
            displayValue={`${angle}°`}
            onChange={(v) => handleChange('angle', v)}
          />
        </div>
      )}
    </div>
  )
}

interface SliderFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (value: number) => void
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange
}: SliderFieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
          {displayValue}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-[var(--color-border)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)]"
      />
    </div>
  )
}
