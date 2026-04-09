/**
 * Maps between DOM/Gamepad API names and BeamNG's internal control names,
 * plus human-readable display labels.
 */

/** DOM KeyboardEvent.code → BeamNG control name */
export const domKeyToBeamNG: Record<string, string> = {
  // Letters
  KeyA: 'a', KeyB: 'b', KeyC: 'c', KeyD: 'd', KeyE: 'e', KeyF: 'f',
  KeyG: 'g', KeyH: 'h', KeyI: 'i', KeyJ: 'j', KeyK: 'k', KeyL: 'l',
  KeyM: 'm', KeyN: 'n', KeyO: 'o', KeyP: 'p', KeyQ: 'q', KeyR: 'r',
  KeyS: 's', KeyT: 't', KeyU: 'u', KeyV: 'v', KeyW: 'w', KeyX: 'x',
  KeyY: 'y', KeyZ: 'z',
  // Digits
  Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4',
  Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
  // Function keys
  F1: 'f1', F2: 'f2', F3: 'f3', F4: 'f4', F5: 'f5', F6: 'f6',
  F7: 'f7', F8: 'f8', F9: 'f9', F10: 'f10', F11: 'f11', F12: 'f12',
  // Navigation
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  Insert: 'insert', Delete: 'delete',
  // Modifiers
  ShiftLeft: 'lshift', ShiftRight: 'rshift',
  ControlLeft: 'lcontrol', ControlRight: 'rcontrol',
  AltLeft: 'lalt', AltRight: 'ralt',
  // Special
  Escape: 'escape', Enter: 'return', NumpadEnter: 'numpadenter',
  Space: 'space', Tab: 'tab', Backspace: 'backspace',
  CapsLock: 'capslock', NumLock: 'numlock', ScrollLock: 'scroll',
  Pause: 'pause', PrintScreen: 'print',
  // Punctuation
  Backquote: 'tilde', Minus: 'minus', Equal: 'equals',
  BracketLeft: 'lbracket', BracketRight: 'rbracket',
  Backslash: 'backslash', Semicolon: 'semicolon',
  Quote: 'apostrophe', Comma: 'comma', Period: 'period', Slash: 'slash',
  // Numpad
  Numpad0: 'numpad0', Numpad1: 'numpad1', Numpad2: 'numpad2',
  Numpad3: 'numpad3', Numpad4: 'numpad4', Numpad5: 'numpad5',
  Numpad6: 'numpad6', Numpad7: 'numpad7', Numpad8: 'numpad8',
  Numpad9: 'numpad9',
  NumpadAdd: 'add', NumpadSubtract: 'subtract',
  NumpadMultiply: 'multiply', NumpadDivide: 'divide',
  NumpadDecimal: 'decimal'
}

/** Standard Gamepad API button index → BeamNG xinput control name */
export const gamepadButtonToBeamNG: Record<number, string> = {
  0: 'button_a',
  1: 'button_b',
  2: 'button_x',
  3: 'button_y',
  4: 'button_l1',
  5: 'button_r1',
  6: 'button_l2',
  7: 'button_r2',
  8: 'button_back',
  9: 'button_start',
  10: 'thumbl',
  11: 'thumbr',
  12: 'dpup',
  13: 'dpdown',
  14: 'dpleft',
  15: 'dpright'
}

/** Standard Gamepad API axis index → BeamNG xinput control name */
export const gamepadAxisToBeamNG: Record<number, string> = {
  0: 'thumblx',
  1: 'thumbly',
  2: 'thumbrx',
  3: 'thumbry'
}

/** BeamNG control name → human-readable display string */
export const beamNGControlToDisplay: Record<string, string> = {
  // Keyboard letters
  a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F',
  g: 'G', h: 'H', i: 'I', j: 'J', k: 'K', l: 'L',
  m: 'M', n: 'N', o: 'O', p: 'P', q: 'Q', r: 'R',
  s: 'S', t: 'T', u: 'U', v: 'V', w: 'W', x: 'X',
  y: 'Y', z: 'Z',
  // Digits
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  // Function keys
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5', f6: 'F6',
  f7: 'F7', f8: 'F8', f9: 'F9', f10: 'F10', f11: 'F11', f12: 'F12',
  // Navigation
  up: '↑', down: '↓', left: '←', right: '→',
  home: 'Home', end: 'End', pageup: 'Page Up', pagedown: 'Page Down',
  insert: 'Insert', delete: 'Delete',
  // Modifiers
  lshift: 'Left Shift', rshift: 'Right Shift',
  lcontrol: 'Left Ctrl', rcontrol: 'Right Ctrl',
  lalt: 'Left Alt', ralt: 'Right Alt',
  // Special
  escape: 'Esc', return: 'Enter', numpadenter: 'Numpad Enter',
  space: 'Space', tab: 'Tab', backspace: 'Backspace',
  capslock: 'Caps Lock', numlock: 'Num Lock', scroll: 'Scroll Lock',
  pause: 'Pause', print: 'Print Screen',
  // Punctuation
  tilde: '~', minus: '-', equals: '=',
  lbracket: '[', rbracket: ']', backslash: '\\',
  semicolon: ';', apostrophe: "'", comma: ',', period: '.', slash: '/',
  // Numpad
  numpad0: 'Num 0', numpad1: 'Num 1', numpad2: 'Num 2',
  numpad3: 'Num 3', numpad4: 'Num 4', numpad5: 'Num 5',
  numpad6: 'Num 6', numpad7: 'Num 7', numpad8: 'Num 8',
  numpad9: 'Num 9',
  add: 'Num +', subtract: 'Num -', multiply: 'Num *',
  divide: 'Num /', decimal: 'Num .',
  // Gamepad / xinput
  button_a: 'A Button', button_b: 'B Button',
  button_x: 'X Button', button_y: 'Y Button',
  button_l1: 'LB', button_r1: 'RB',
  button_l2: 'LT', button_r2: 'RT',
  button_back: 'Back', button_start: 'Start',
  thumbl: 'Left Stick Press', thumbr: 'Right Stick Press',
  dpup: 'D-Pad Up', dpdown: 'D-Pad Down',
  dpleft: 'D-Pad Left', dpright: 'D-Pad Right',
  thumblx: 'Left Stick X', thumbly: 'Left Stick Y',
  thumbrx: 'Right Stick X', thumbry: 'Right Stick Y',
  triggerl: 'Left Trigger', triggerr: 'Right Trigger',
  // Mouse
  button0: 'Left Click', button1: 'Right Click', button2: 'Middle Click',
  posx: 'Mouse X', posy: 'Mouse Y', wheel: 'Mouse Wheel',
  // Joystick / wheel common
  xaxis: 'X Axis', yaxis: 'Y Axis', zaxis: 'Z Axis',
  rxaxis: 'Rotate X', ryaxis: 'Rotate Y', rzaxis: 'Rotate Z',
  slider0: 'Slider 1', slider1: 'Slider 2'
}

/** Get display name for a BeamNG control. Falls back to formatted control name. */
export function getControlDisplayName(control: string): string {
  if (beamNGControlToDisplay[control]) return beamNGControlToDisplay[control]
  // Joystick buttons: button0-127
  const btnMatch = control.match(/^button(\d+)$/)
  if (btnMatch) return `Button ${btnMatch[1]}`
  // Format unknown controls: "some_control" → "Some Control"
  return control.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Reverse lookup: find DOM key code for a BeamNG control name */
const beamNGToDomKey = new Map<string, string>()
for (const [dom, beamng] of Object.entries(domKeyToBeamNG)) {
  beamNGToDomKey.set(beamng, dom)
}
export function beamNGToKeyCode(control: string): string | undefined {
  return beamNGToDomKey.get(control)
}
