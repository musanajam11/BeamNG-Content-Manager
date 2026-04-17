import { useEffect, useRef, useCallback } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { domKeyToBeamNG, gamepadButtonToBeamNG, gamepadAxisToBeamNG } from '../../../../shared/controlNameMaps'
import type { InputDeviceType } from '../../../../shared/types'

interface BindingCaptureModalProps {
  actionName: string
  deviceType: InputDeviceType
  onCapture: (control: string) => void
  onCancel: () => void
}

export function BindingCaptureModal({
  actionName,
  deviceType,
  onCapture,
  onCancel
}: BindingCaptureModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const gamepadPollRef = useRef<number | null>(null)
  const prevButtonsRef = useRef<boolean[]>([])
  const prevAxesRef = useRef<number[]>([])

  // Keyboard capture
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.code === 'Escape') {
        onCancel()
        return
      }

      const beamControl = domKeyToBeamNG[e.code]
      if (beamControl) {
        onCapture(beamControl)
      }
    },
    [onCapture, onCancel]
  )

  useEffect(() => {
    if (deviceType === 'keyboard' || deviceType === 'mouse') {
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }

    // Gamepad polling function (used for xinput and joystick)
    const pollGamepad = (): void => {
      const gamepads = navigator.getGamepads()
      for (const gp of gamepads) {
        if (!gp) continue

        // Check buttons
        for (let i = 0; i < gp.buttons.length; i++) {
          const pressed = gp.buttons[i].pressed
          const wasPrevPressed = prevButtonsRef.current[i] ?? false

          if (pressed && !wasPrevPressed) {
            const beamControl = gamepadButtonToBeamNG[i]
            if (beamControl) {
              onCapture(beamControl)
              return
            }
          }
        }
        prevButtonsRef.current = gp.buttons.map((b) => b.pressed)

        // Check axes (threshold-based detection)
        for (let i = 0; i < gp.axes.length; i++) {
          const value = gp.axes[i]
          const prevValue = prevAxesRef.current[i] ?? 0
          const THRESHOLD = 0.7

          if (Math.abs(value) > THRESHOLD && Math.abs(prevValue) < THRESHOLD) {
            const beamControl = gamepadAxisToBeamNG[i]
            if (beamControl) {
              onCapture(beamControl)
              return
            }
          }
        }
        prevAxesRef.current = [...gp.axes]
      }

      gamepadPollRef.current = requestAnimationFrame(pollGamepad)
    }

    if (deviceType === 'xinput') {
      gamepadPollRef.current = requestAnimationFrame(pollGamepad)
      return () => {
        if (gamepadPollRef.current !== null) {
          cancelAnimationFrame(gamepadPollRef.current)
        }
      }
    }

    // For joystick (wheel) — also use Gamepad API as many wheels expose as gamepad
    if (deviceType === 'joystick') {
      // Listen to keyboard as fallback + gamepad polling
      window.addEventListener('keydown', handleKeyDown, true)
      gamepadPollRef.current = requestAnimationFrame(pollGamepad)
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
        if (gamepadPollRef.current !== null) {
          cancelAnimationFrame(gamepadPollRef.current)
        }
      }
    }

    return undefined
  }, [deviceType, handleKeyDown, onCapture])

  const promptText =
    deviceType === 'xinput'
      ? t('controls.bindActionGamepad')
      : deviceType === 'joystick'
        ? t('controls.bindActionWheel')
        : t('controls.bindAction')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-scrim-60)] backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="glass-raised w-96 p-6 rounded-lg flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between w-full">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
            {actionName}
          </h3>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            <X size={14} className="text-[var(--color-text-muted)]" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-16 h-16 rounded-full border-2 border-[var(--color-accent)]/40 flex items-center justify-center animate-pulse">
            <div className="w-3 h-3 rounded-full bg-[var(--color-accent)]" />
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] text-center">
            {promptText}
          </p>
          <p className="text-[10px] text-[var(--color-text-muted)]">
            {t('controls.bindEscape')}
          </p>
        </div>
      </div>
    </div>
  )
}
