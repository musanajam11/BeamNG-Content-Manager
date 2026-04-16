import { useState, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { FFBConfig } from '../../../../shared/types'

interface FFBSettingsPanelProps {
  ffbConfig: FFBConfig | null
  onUpdate: (config: Partial<FFBConfig>) => void
}

const DEFAULT_FFB: FFBConfig = {
  forceCoef: 100,
  smoothing: 0,
  smoothing2: 0,
  smoothing2automatic: true,
  lowspeedCoef: false,
  responseCorrected: true,
  responseCurve: [[0, 0], [1, 1]],
  updateType: 0
}

const UPDATE_TYPES = [
  { value: 0, labelKey: 'controls.ffbUpdateFast' },
  { value: 1, labelKey: 'controls.ffbUpdateSmooth' },
  { value: 2, labelKey: 'controls.ffbUpdateLegacy' }
]

export function FFBSettingsPanel({
  ffbConfig,
  onUpdate
}: FFBSettingsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const config = { ...DEFAULT_FFB, ...(ffbConfig ?? {}) }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Force Coefficient */}
      <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">
          {t('controls.ffbStrength')}
        </h3>
        <div className="space-y-3">
          <FFBSlider
            label={t('controls.ffbForceCoef')}
            value={config.forceCoef}
            min={0}
            max={400}
            step={5}
            displayValue={`${config.forceCoef}%`}
            onChange={(v) => onUpdate({ forceCoef: v })}
          />
        </div>
      </div>

      {/* Smoothing */}
      <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">
          {t('controls.ffbSmoothing')}
        </h3>
        <div className="space-y-3">
          <FFBSlider
            label={t('controls.ffbSmoothing1')}
            value={config.smoothing}
            min={0}
            max={200}
            step={1}
            displayValue={String(config.smoothing)}
            onChange={(v) => onUpdate({ smoothing: v })}
          />
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <FFBSlider
                label={t('controls.ffbSmoothing2')}
                value={config.smoothing2}
                min={0}
                max={200}
                step={1}
                displayValue={config.smoothing2automatic ? 'Auto' : String(config.smoothing2)}
                onChange={(v) => onUpdate({ smoothing2: v, smoothing2automatic: false })}
                disabled={config.smoothing2automatic}
              />
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)] shrink-0 mt-3">
              <input
                type="checkbox"
                checked={config.smoothing2automatic}
                onChange={(e) => onUpdate({ smoothing2automatic: e.target.checked })}
                className="rounded-full"
              />
              {t('controls.ffbAuto')}
            </label>
          </div>
        </div>
      </div>

      {/* Options */}
      <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">
          {t('controls.ffbOptions')}
        </h3>
        <div className="space-y-2.5">
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={config.lowspeedCoef}
              onChange={(e) => onUpdate({ lowspeedCoef: e.target.checked })}
              className="rounded-full"
            />
            {t('controls.ffbLowSpeed')}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
            <input
              type="checkbox"
              checked={config.responseCorrected}
              onChange={(e) => onUpdate({ responseCorrected: e.target.checked })}
              className="rounded-full"
            />
            {t('controls.ffbResponseCorrected')}
          </label>
        </div>

        {/* Update type */}
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <span className="text-[10px] text-[var(--color-text-muted)] block mb-2">
            {t('controls.ffbUpdateType')}
          </span>
          <div className="flex gap-2">
            {UPDATE_TYPES.map((ut) => (
              <button
                key={ut.value}
                onClick={() => onUpdate({ updateType: ut.value })}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  config.updateType === ut.value
                    ? 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                {t(ut.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Response Curve */}
      <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
        <h3 className="text-xs font-semibold text-[var(--color-text-primary)] mb-3">
          {t('controls.ffbResponseCurve')}
        </h3>
        <ResponseCurveEditor
          points={config.responseCurve}
          onChange={(pts) => onUpdate({ responseCurve: pts })}
        />
      </div>
    </div>
  )
}

/* ── FFB Slider ── */

interface FFBSliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  displayValue: string
  onChange: (value: number) => void
  disabled?: boolean
}

function FFBSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
  disabled
}: FFBSliderProps): React.JSX.Element {
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
        disabled={disabled}
        className="w-full h-1.5 bg-[var(--color-border)] rounded-full appearance-none cursor-pointer accent-[var(--color-accent)] disabled:opacity-40 disabled:cursor-not-allowed"
      />
    </div>
  )
}

/* ── Response Curve Editor ── */

interface ResponseCurveEditorProps {
  points: [number, number][]
  onChange: (points: [number, number][]) => void
}

function ResponseCurveEditor({
  points,
  onChange
}: ResponseCurveEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  // Local points state for smooth dragging without IPC round-trip
  const [localPoints, setLocalPoints] = useState<[number, number][] | null>(null)

  const SIZE = 200
  const PAD = 24

  // Use local points during drag, prop points otherwise
  const activePoints: [number, number][] =
    localPoints ?? (Array.isArray(points) ? points : [[0, 0], [1, 1]])

  const toSvg = useCallback(
    (p: [number, number]): [number, number] => [
      PAD + p[0] * (SIZE - PAD * 2),
      SIZE - PAD - p[1] * (SIZE - PAD * 2)
    ],
    []
  )

  const fromSvg = useCallback(
    (x: number, y: number): [number, number] => [
      Math.max(0, Math.min(1, (x - PAD) / (SIZE - PAD * 2))),
      Math.max(0, Math.min(1, (SIZE - PAD - y) / (SIZE - PAD * 2)))
    ],
    []
  )

  const sortedPoints = useMemo(
    () =>
      [...activePoints]
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .sort((a, b) => a[0] - b[0]),
    [activePoints]
  )

  const pathD = useMemo(() => {
    if (sortedPoints.length === 0) return ''
    const pts = sortedPoints.map(toSvg)
    return `M ${pts.map((p) => `${p[0]},${p[1]}`).join(' L ')}`
  }, [sortedPoints, toSvg])

  const handleMouseDown = (idx: number, e: React.MouseEvent): void => {
    e.preventDefault()
    setDragging(idx)
    // Start local editing from current sorted points
    setLocalPoints([...sortedPoints])
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging === null || !svgRef.current || !localPoints) return
      if (dragging < 0 || dragging >= sortedPoints.length) return
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const [nx, ny] = fromSvg(x, y)

      const newPoints: [number, number][] = [...sortedPoints]
      // First/last point: lock x
      if (dragging === 0) {
        newPoints[dragging] = [0, ny]
      } else if (dragging === sortedPoints.length - 1) {
        newPoints[dragging] = [1, ny]
      } else {
        newPoints[dragging] = [nx, ny]
      }
      setLocalPoints(newPoints)
    },
    [dragging, sortedPoints, localPoints, fromSvg]
  )

  const handleMouseUp = useCallback(() => {
    if (dragging !== null && localPoints) {
      // Commit final position to backend
      const finalPoints = [...localPoints]
        .filter((p) => Array.isArray(p) && p.length >= 2)
        .sort((a, b) => a[0] - b[0])
      onChange(finalPoints)
    }
    setDragging(null)
    setLocalPoints(null)
  }, [dragging, localPoints, onChange])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const [nx, ny] = fromSvg(x, y)

      const newPoints: [number, number][] = [...sortedPoints, [nx, ny]]
      onChange(newPoints)
    },
    [sortedPoints, fromSvg, onChange]
  )

  const handleRemovePoint = useCallback(
    (idx: number) => {
      // Don't remove first/last
      if (idx === 0 || idx === sortedPoints.length - 1) return
      const newPoints = sortedPoints.filter((_, i) => i !== idx)
      onChange(newPoints)
    },
    [sortedPoints, onChange]
  )

  const resetCurve = useCallback(() => {
    onChange([[0, 0], [1, 1]])
  }, [onChange])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          onClick={resetCurve}
          className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
        >
          {t('controls.ffbResetCurve')}
        </button>
      </div>
      <div className="relative bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] overflow-hidden">
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          className="w-full"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
        >
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map((v) => {
            const [sx, sy] = toSvg([v, 0])
            const [, ey] = toSvg([v, 1])
            return (
              <line
                key={`vg-${v}`}
                x1={sx}
                y1={sy}
                x2={sx}
                y2={ey}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
            )
          })}
          {[0.25, 0.5, 0.75].map((v) => {
            const [sx, sy] = toSvg([0, v])
            const [ex] = toSvg([1, v])
            return (
              <line
                key={`hg-${v}`}
                x1={sx}
                y1={sy}
                x2={ex}
                y2={sy}
                stroke="var(--color-border)"
                strokeWidth={0.5}
                strokeDasharray="2 2"
              />
            )
          })}

          {/* Linear reference */}
          <line
            x1={toSvg([0, 0])[0]}
            y1={toSvg([0, 0])[1]}
            x2={toSvg([1, 1])[0]}
            y2={toSvg([1, 1])[1]}
            stroke="var(--color-text-muted)"
            strokeWidth={0.5}
            opacity={0.3}
          />

          {/* Curve */}
          <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth={2} />

          {/* Points */}
          {sortedPoints.map((p, i) => {
            const [sx, sy] = toSvg(p)
            return (
              <circle
                key={i}
                cx={sx}
                cy={sy}
                r={dragging === i ? 6 : 4}
                fill="var(--color-accent)"
                stroke="white"
                strokeWidth={1.5}
                className="cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => handleMouseDown(i, e)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  handleRemovePoint(i)
                }}
              />
            )
          })}
        </svg>
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] text-center">
        {t('controls.ffbCurveHint')}
      </p>
    </div>
  )
}
