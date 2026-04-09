import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useControlsStore } from '../../stores/useControlsStore'
import type { SteeringFilterSettings } from '../../../../shared/types'

export function SteeringFilterPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const { steeringSettings, loadSteeringSettings, updateSteeringSettings } = useControlsStore()

  useEffect(() => {
    loadSteeringSettings()
  }, [])

  const handleUpdate = useCallback(
    (changes: Partial<SteeringFilterSettings>) => {
      updateSteeringSettings(changes)
    },
    [updateSteeringSettings]
  )

  if (!steeringSettings) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--color-text-muted)]">
        {t('controls.filtersLoading')}
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      <div className="grid grid-cols-2 gap-4">
        {/* Keyboard / Gamepad Column */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wider px-1">
            {t('controls.filtersKeyboard')}
          </h3>

          <FilterGroup
            title={t('controls.filterAutocenter')}
            enabled={steeringSettings.steeringAutocenterEnabled}
            onToggle={(v) => handleUpdate({ steeringAutocenterEnabled: v })}
          />

          <FilterGroup
            title={t('controls.filterSlowdown')}
            enabled={steeringSettings.steeringSlowdownEnabled}
            onToggle={(v) => handleUpdate({ steeringSlowdownEnabled: v })}
          >
            <FilterSlider
              label={t('controls.filterSlowdownStart')}
              value={steeringSettings.steeringSlowdownStartSpeed}
              min={0}
              max={200}
              step={5}
              unit=" km/h"
              onChange={(v) => handleUpdate({ steeringSlowdownStartSpeed: v })}
            />
            <FilterSlider
              label={t('controls.filterSlowdownEnd')}
              value={steeringSettings.steeringSlowdownEndSpeed}
              min={0}
              max={400}
              step={5}
              unit=" km/h"
              onChange={(v) => handleUpdate({ steeringSlowdownEndSpeed: v })}
            />
            <FilterSlider
              label={t('controls.filterSlowdownMult')}
              value={steeringSettings.steeringSlowdownMultiplier}
              min={0}
              max={1}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringSlowdownMultiplier: v })}
            />
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterLimit')}
            enabled={steeringSettings.steeringLimitEnabled}
            onToggle={(v) => handleUpdate({ steeringLimitEnabled: v })}
          >
            {steeringSettings.steeringLimitMultiplier !== undefined && (
              <FilterSlider
                label={t('controls.filterLimitMult')}
                value={steeringSettings.steeringLimitMultiplier}
                min={0}
                max={2}
                step={0.05}
                unit=""
                displayDecimals={2}
                onChange={(v) => handleUpdate({ steeringLimitMultiplier: v })}
              />
            )}
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterStabilization')}
            enabled={steeringSettings.steeringStabilizationEnabled}
            onToggle={(v) => handleUpdate({ steeringStabilizationEnabled: v })}
          >
            <FilterSlider
              label={t('controls.filterStabilizationMult')}
              value={steeringSettings.steeringStabilizationMultiplier}
              min={0}
              max={2}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringStabilizationMultiplier: v })}
            />
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterUndersteer')}
            enabled={steeringSettings.steeringUndersteerReductionEnabled}
            onToggle={(v) => handleUpdate({ steeringUndersteerReductionEnabled: v })}
          >
            <FilterSlider
              label={t('controls.filterUndersteerMult')}
              value={steeringSettings.steeringUndersteerReductionMultiplier}
              min={0}
              max={2}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringUndersteerReductionMultiplier: v })}
            />
          </FilterGroup>
        </div>

        {/* Direct Input / Wheel Column */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wider px-1">
            {t('controls.filtersWheel')}
          </h3>

          <FilterGroup
            title={t('controls.filterAutocenter')}
            enabled={steeringSettings.steeringAutocenterEnabledDirect}
            onToggle={(v) => handleUpdate({ steeringAutocenterEnabledDirect: v })}
          />

          <FilterGroup
            title={t('controls.filterSlowdown')}
            enabled={steeringSettings.steeringSlowdownEnabledDirect}
            onToggle={(v) => handleUpdate({ steeringSlowdownEnabledDirect: v })}
          >
            <FilterSlider
              label={t('controls.filterSlowdownStart')}
              value={steeringSettings.steeringSlowdownStartSpeedDirect}
              min={0}
              max={200}
              step={5}
              unit=" km/h"
              onChange={(v) => handleUpdate({ steeringSlowdownStartSpeedDirect: v })}
            />
            <FilterSlider
              label={t('controls.filterSlowdownEnd')}
              value={steeringSettings.steeringSlowdownEndSpeedDirect}
              min={0}
              max={400}
              step={5}
              unit=" km/h"
              onChange={(v) => handleUpdate({ steeringSlowdownEndSpeedDirect: v })}
            />
            <FilterSlider
              label={t('controls.filterSlowdownMult')}
              value={steeringSettings.steeringSlowdownMultiplierDirect}
              min={0}
              max={1}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringSlowdownMultiplierDirect: v })}
            />
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterLimit')}
            enabled={steeringSettings.steeringLimitEnabledDirect}
            onToggle={(v) => handleUpdate({ steeringLimitEnabledDirect: v })}
          >
            {steeringSettings.steeringLimitMultiplierDirect !== undefined && (
              <FilterSlider
                label={t('controls.filterLimitMult')}
                value={steeringSettings.steeringLimitMultiplierDirect}
                min={0}
                max={2}
                step={0.05}
                unit=""
                displayDecimals={2}
                onChange={(v) => handleUpdate({ steeringLimitMultiplierDirect: v })}
              />
            )}
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterStabilization')}
            enabled={steeringSettings.steeringStabilizationEnabledDirect}
            onToggle={(v) => handleUpdate({ steeringStabilizationEnabledDirect: v })}
          >
            <FilterSlider
              label={t('controls.filterStabilizationMult')}
              value={steeringSettings.steeringStabilizationMultiplierDirect}
              min={0}
              max={2}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringStabilizationMultiplierDirect: v })}
            />
          </FilterGroup>

          <FilterGroup
            title={t('controls.filterUndersteer')}
            enabled={steeringSettings.steeringUndersteerReductionEnabledDirect}
            onToggle={(v) => handleUpdate({ steeringUndersteerReductionEnabledDirect: v })}
          >
            <FilterSlider
              label={t('controls.filterUndersteerMult')}
              value={steeringSettings.steeringUndersteerReductionMultiplierDirect}
              min={0}
              max={2}
              step={0.05}
              unit=""
              displayDecimals={2}
              onChange={(v) => handleUpdate({ steeringUndersteerReductionMultiplierDirect: v })}
            />
          </FilterGroup>
        </div>
      </div>
    </div>
  )
}

/* ── Filter Group (toggle + optional children) ── */

interface FilterGroupProps {
  title: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children?: React.ReactNode
}

function FilterGroup({ title, enabled, onToggle, children }: FilterGroupProps): React.JSX.Element {
  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden bg-[var(--color-surface)]">
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-xs font-medium text-[var(--color-text-primary)]">{title}</span>
        <button
          onClick={() => onToggle(!enabled)}
          className={`relative w-8 h-[18px] rounded-full transition-colors ${
            enabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
          }`}
        >
          <span
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-[17px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>
      {enabled && children && (
        <div className="px-3 pb-3 space-y-2 border-t border-[var(--color-border)]">
          <div className="pt-2 space-y-2">{children}</div>
        </div>
      )}
    </div>
  )
}

/* ── Filter Slider ── */

interface FilterSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  displayDecimals?: number
  onChange: (value: number) => void
}

function FilterSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  displayDecimals = 0,
  onChange
}: FilterSliderProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[10px] font-mono text-[var(--color-text-secondary)]">
          {value.toFixed(displayDecimals)}{unit}
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
