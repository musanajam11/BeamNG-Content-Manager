import { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Pause, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { InputDeviceType } from '../../../../shared/types'

interface LiveInputPanelProps {
  deviceType: InputDeviceType
  deviceName?: string
}

interface GamepadState {
  index: number
  axes: { index: number; value: number }[]
  buttons: { index: number; pressed: boolean; value: number }[]
  id: string
}

interface KeyboardState {
  pressedKeys: Set<string>
}

export function LiveInputPanel({ deviceType, deviceName }: LiveInputPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [polling, setPolling] = useState(false)
  const [gamepadStates, setGamepadStates] = useState<GamepadState[]>([])
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({ pressedKeys: new Set() })
  const rafRef = useRef<number | null>(null)
  const pressedKeysRef = useRef<Set<string>>(new Set())

  const isGamepadDevice = deviceType === 'xinput' || deviceType === 'joystick'
  const isKeyboardDevice = deviceType === 'keyboard' || deviceType === 'mouse'

  // Gamepad polling loop — capture ALL connected gamepads
  const pollGamepad = useCallback(() => {
    const gamepads = navigator.getGamepads()
    const states: GamepadState[] = []
    for (const gp of gamepads) {
      if (!gp) continue
      states.push({
        index: gp.index,
        id: gp.id,
        axes: gp.axes.map((v, i) => ({ index: i, value: v })),
        buttons: gp.buttons.map((b, i) => ({ index: i, pressed: b.pressed, value: b.value }))
      })
    }
    setGamepadStates(states)
    rafRef.current = requestAnimationFrame(pollGamepad)
  }, [])

  // Keyboard handlers
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    pressedKeysRef.current.add(e.code)
    setKeyboardState({ pressedKeys: new Set(pressedKeysRef.current) })
  }, [])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    pressedKeysRef.current.delete(e.code)
    setKeyboardState({ pressedKeys: new Set(pressedKeysRef.current) })
  }, [])

  useEffect(() => {
    if (!polling) return

    if (isGamepadDevice) {
      rafRef.current = requestAnimationFrame(pollGamepad)
      return () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      }
    }

    if (isKeyboardDevice) {
      window.addEventListener('keydown', handleKeyDown, true)
      window.addEventListener('keyup', handleKeyUp, true)
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
        window.removeEventListener('keyup', handleKeyUp, true)
        pressedKeysRef.current.clear()
        setKeyboardState({ pressedKeys: new Set() })
      }
    }
  }, [polling, isGamepadDevice, isKeyboardDevice, pollGamepad, handleKeyDown, handleKeyUp])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="space-y-3 max-w-4xl">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className={polling ? 'text-green-400' : 'text-[var(--color-text-muted)]'} />
          <span className="text-xs font-medium text-[var(--color-text-primary)]">
            {t('controls.liveInputTitle')}
          </span>
          {polling && (
            <span className="text-[10px] text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              {t('controls.liveInputActive')}
            </span>
          )}
        </div>
        <button
          onClick={() => setPolling(!polling)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
            polling
              ? 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
              : 'bg-[var(--color-accent-subtle)] text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/20'
          }`}
        >
          {polling ? <Pause size={12} /> : <Play size={12} />}
          {polling ? t('controls.liveInputStop') : t('controls.liveInputStart')}
        </button>
      </div>

      {!polling && (
        <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
          <Activity size={48} className="text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">{t('controls.liveInputHint')}</p>
        </div>
      )}

      {/* Gamepad visualization — show all connected devices */}
      {polling && isGamepadDevice && (
        gamepadStates.length > 0 ? (
          <div className="space-y-4">
            {gamepadStates.map((state) => (
              <GamepadVisualization key={state.index} state={state} />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">
            {t('controls.liveInputNoGamepad')}
          </div>
        )
      )}

      {/* Keyboard visualization */}
      {polling && isKeyboardDevice && (
        <KeyboardVisualization state={keyboardState} />
      )}
    </div>
  )
}

/* ── Gamepad Visualization ── */

function GamepadVisualization({ state }: { state: GamepadState }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="border border-[var(--color-border)] rounded-lg overflow-hidden">
      {/* Device header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
        <Activity size={12} className="text-green-400" />
        <span className="text-[11px] font-medium text-[var(--color-text-primary)] truncate">
          {state.id}
        </span>
        <span className="text-[10px] text-[var(--color-text-muted)] shrink-0">
          #{state.index}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Axes */}
        {state.axes.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              {t('controls.liveInputAxes')}
            </h4>
            <div className="space-y-2">
              {state.axes.map((axis) => (
                <div key={axis.index} className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)] w-16 shrink-0">
                    Axis {axis.index}
                  </span>
                  <div className="flex-1 h-3 bg-black/20 rounded-full overflow-hidden relative">
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[var(--color-border)]" />
                    <div
                      className="absolute top-0 bottom-0 bg-[var(--color-accent)] transition-all duration-[16ms]"
                      style={{
                        left: axis.value >= 0 ? '50%' : `${50 + axis.value * 50}%`,
                        width: `${Math.abs(axis.value) * 50}%`
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[var(--color-text-secondary)] w-14 text-right shrink-0">
                    {axis.value.toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Buttons */}
        {state.buttons.length > 0 && (
          <div>
            <h4 className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              {t('controls.liveInputButtons')}
            </h4>
            <div className="grid grid-cols-8 gap-2">
              {state.buttons.map((btn) => (
                <div
                  key={btn.index}
                  className={`flex flex-col items-center justify-center py-2 rounded-md border transition-colors ${
                    btn.pressed
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                      : 'bg-black/10 border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  <span className="text-[10px] font-mono">{btn.index}</span>
                  {btn.value > 0 && !btn.pressed && (
                    <div className="w-full mt-1 px-1">
                      <div className="h-0.5 bg-black/20 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[var(--color-accent)] transition-all duration-[16ms]"
                          style={{ width: `${btn.value * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Keyboard Visualization ── */

const KEYBOARD_ROWS = [
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal', 'Backspace'],
  ['Tab', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['CapsLock', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote', 'Enter'],
  ['ShiftLeft', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'ShiftRight'],
  ['ControlLeft', 'MetaLeft', 'AltLeft', 'Space', 'AltRight', 'MetaRight', 'ControlRight']
]

const KEY_DISPLAY: Record<string, string> = {
  Escape: 'Esc', Backquote: '`', Minus: '-', Equal: '=', Backspace: '⌫',
  Tab: 'Tab', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  CapsLock: 'Caps', Semicolon: ';', Quote: "'", Enter: '↵',
  ShiftLeft: '⇧L', ShiftRight: '⇧R', Comma: ',', Period: '.', Slash: '/',
  ControlLeft: 'Ctrl', ControlRight: 'Ctrl', MetaLeft: 'Win', MetaRight: 'Win',
  AltLeft: 'Alt', AltRight: 'Alt', Space: '⎵',
  Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
  Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
  KeyA: 'A', KeyB: 'B', KeyC: 'C', KeyD: 'D', KeyE: 'E', KeyF: 'F',
  KeyG: 'G', KeyH: 'H', KeyI: 'I', KeyJ: 'J', KeyK: 'K', KeyL: 'L',
  KeyM: 'M', KeyN: 'N', KeyO: 'O', KeyP: 'P', KeyQ: 'Q', KeyR: 'R',
  KeyS: 'S', KeyT: 'T', KeyU: 'U', KeyV: 'V', KeyW: 'W', KeyX: 'X',
  KeyY: 'Y', KeyZ: 'Z',
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
  F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12'
}

function KeyboardVisualization({ state }: { state: KeyboardState }): React.JSX.Element {
  return (
    <div className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)]">
      <div className="space-y-1.5">
        {KEYBOARD_ROWS.map((row, rowIdx) => (
          <div key={rowIdx} className="flex gap-1 justify-center">
            {row.map((code) => {
              const pressed = state.pressedKeys.has(code)
              const isWide = code === 'Space'
              const isMedium =
                code === 'Backspace' ||
                code === 'Tab' ||
                code === 'CapsLock' ||
                code === 'Enter' ||
                code === 'ShiftLeft' ||
                code === 'ShiftRight'
              return (
                <div
                  key={code}
                  className={`flex items-center justify-center rounded border text-[9px] font-mono transition-colors ${
                    isWide ? 'w-32' : isMedium ? 'w-14' : 'w-8'
                  } h-7 ${
                    pressed
                      ? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-white'
                      : 'bg-black/10 border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {KEY_DISPLAY[code] ?? code}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
