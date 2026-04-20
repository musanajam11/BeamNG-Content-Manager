import { create } from 'zustand'
import type { AppearanceSettings, AppPage } from '../../../shared/types'

export const DEFAULT_SIDEBAR_ORDER: AppPage[] = [
  'home', 'servers', 'friends', 'vehicles', 'maps', 'mods',
  'career', 'server-admin', 'launcher', 'controls', 'live-gps', 'livery-editor', 'voice-chat',
  'lua-console'
]

const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorMode: 'dark',
  accentColor: '#f97316',
  uiScale: 1.1,
  fontSize: 16,
  backgroundStyle: 'default',
  surfaceOpacity: 1.0,
  borderOpacity: 1.0,
  enableBlur: true,
  bgGradient1: null,
  bgGradient2: null,
  sidebarWidth: 200,
  bgImagePath: null,
  bgImageBlur: 0,
  bgImageOpacity: 0.3,
  bgImageList: [],
  bgCycleOnLaunch: false,
  sidebarOrder: [...DEFAULT_SIDEBAR_ORDER],
  sidebarHidden: [],
  customCSS: '',
  customCSSEnabled: false,
  cornerRadius: 0,
  buttonSize: 'default',
  fontFamily: 'system',
  scrollbarStyle: 'rounded',
  animationSpeed: 'normal',
  overlayEffect: 'none',
  borderStyle: 'normal',
  effectPageFade: true,
  effectFrostedGlass: false,
  effectAccentSelection: true,
  effectHoverGlow: false,
  effectHoverLift: false,
  filterBrightness: 1.0,
  filterContrast: 1.0,
  filterSaturation: 1.0
}

/** Preset accent color palettes */
export const ACCENT_PRESETS = [
  { name: 'BeamMP Orange', color: '#f97316' },
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Purple', color: '#8b5cf6' },
  { name: 'Emerald', color: '#10b981' },
  { name: 'Rose', color: '#f43f5e' },
  { name: 'Cyan', color: '#06b6d4' },
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Indigo', color: '#6366f1' },
  { name: 'Pink', color: '#ec4899' },
  { name: 'Teal', color: '#14b8a6' },
  { name: 'Lime', color: '#84cc16' },
  { name: 'Sky', color: '#0ea5e9' }
] as const

/** Background style definitions */
export const BG_STYLES = {
  default: {
    label: 'Default',
    description: 'Subtle cyan/blue gradient',
    gradient: (c1: string | null, c2: string | null) => {
      const g1 = c1 || 'rgba(34,211,238,0.09)'
      const g2 = c2 || 'rgba(59,130,246,0.07)'
      return `radial-gradient(circle at top,${g1},transparent 40%),radial-gradient(circle at 80% 0%,${g2},transparent 35%)`
    }
  },
  solid: {
    label: 'Solid',
    description: 'Clean solid background',
    gradient: () => 'none'
  },
  subtle: {
    label: 'Subtle Accent',
    description: 'Gentle accent color wash',
    gradient: (_c1: string | null, _c2: string | null, accent: string) => {
      return `radial-gradient(circle at top,${hexToRgba(accent, 0.06)},transparent 50%)`
    }
  },
  vibrant: {
    label: 'Vibrant',
    description: 'Bold accent gradient',
    gradient: (_c1: string | null, _c2: string | null, accent: string) => {
      return `radial-gradient(circle at top left,${hexToRgba(accent, 0.12)},transparent 40%),radial-gradient(circle at bottom right,${hexToRgba(accent, 0.08)},transparent 50%)`
    }
  }
} as const

interface ThemeStore {
  appearance: AppearanceSettings
  loaded: boolean
  /** The effective color mode after resolving 'system' */
  resolvedMode: 'dark' | 'light'
  load: (settings: AppearanceSettings) => void
  update: (partial: Partial<AppearanceSettings>) => Promise<void>
  reset: () => Promise<void>
}

// ── Palette definitions ──

interface Palette {
  base: string
  surfaceChannel: string   // r,g,b for rgba() surface overlays
  overlayChannel: string   // r,g,b for rgba() scrim overlays
  textPrimary: string
  textSecondary: string
  textMuted: string
  textDim: string
  success: string
  warning: string
  error: string
  info: string
  scrollThumb: string
  scrollThumbHover: string
  colorScheme: 'dark' | 'light'
}

const PALETTES: Record<'dark' | 'light', Palette> = {
  dark: {
    base: '#111113',
    surfaceChannel: '255,255,255',
    overlayChannel: '0,0,0',
    textPrimary: '#ffffff',
    textSecondary: '#cbd5e1',
    textMuted: '#64748b',
    textDim: '#475569',
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
    scrollThumb: 'rgba(255,255,255,0.12)',
    scrollThumbHover: 'rgba(255,255,255,0.20)',
    colorScheme: 'dark'
  },
  light: {
    base: '#f5f5f7',
    surfaceChannel: '0,0,0',
    overlayChannel: '255,255,255',
    textPrimary: '#111113',
    textSecondary: '#475569',
    textMuted: '#64748b',
    textDim: '#94a3b8',
    success: '#16a34a',
    warning: '#d97706',
    error: '#dc2626',
    info: '#2563eb',
    scrollThumb: 'rgba(0,0,0,0.15)',
    scrollThumbHover: 'rgba(0,0,0,0.25)',
    colorScheme: 'light'
  }
}

/** Resolve 'system' to 'dark' or 'light' based on OS preference */
export function resolveColorMode(mode: 'dark' | 'light' | 'system'): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return mode
}

/** Get the current resolved color mode from the store */
export function getResolvedColorMode(): 'dark' | 'light' {
  return useThemeStore.getState().resolvedMode
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  appearance: { ...DEFAULT_APPEARANCE },
  loaded: false,
  resolvedMode: 'dark',

  load: (settings: AppearanceSettings) => {
    const merged = { ...DEFAULT_APPEARANCE, ...settings }
    // Cycle background on launch if enabled
    if (merged.bgCycleOnLaunch && merged.bgImageList.length > 0) {
      const randomIndex = Math.floor(Math.random() * merged.bgImageList.length)
      merged.bgImagePath = merged.bgImageList[randomIndex]
      // Persist the randomly selected background
      window.api.updateConfig({ appearance: merged })
    }
    const resolved = resolveColorMode(merged.colorMode)
    set({ appearance: merged, loaded: true, resolvedMode: resolved })
    applyTheme(merged, resolved)
  },

  update: async (partial: Partial<AppearanceSettings>) => {
    const next = { ...get().appearance, ...partial }
    const resolved = resolveColorMode(next.colorMode)
    set({ appearance: next, resolvedMode: resolved })
    applyTheme(next, resolved)
    // Persist to config
    await window.api.updateConfig({ appearance: next })
  },

  reset: async () => {
    const defaults = { ...DEFAULT_APPEARANCE }
    const resolved = resolveColorMode(defaults.colorMode)
    set({ appearance: defaults, resolvedMode: resolved })
    applyTheme(defaults, resolved)
    await window.api.updateConfig({ appearance: defaults })
  }
}))

// ── Helpers ──

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function darkenHex(hex: string, amount: number): string {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount)
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount)
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function lightenHex(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount)
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount)
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Apply all appearance settings to CSS custom properties + zoom */
export function applyTheme(s: AppearanceSettings, mode: 'dark' | 'light'): void {
  const root = document.documentElement
  const p = PALETTES[mode]
  const accent = s.accentColor

  // Set data-theme for CSS-only selectors and color-scheme
  root.dataset.theme = mode

  // Core palette
  root.style.setProperty('--color-base', p.base)
  root.style.setProperty('--color-text-primary', p.textPrimary)
  root.style.setProperty('--color-text-secondary', p.textSecondary)
  root.style.setProperty('--color-text-muted', p.textMuted)
  root.style.setProperty('--color-text-dim', p.textDim)
  root.style.setProperty('--color-overlay', `rgba(${p.overlayChannel},0.20)`)
  root.style.setProperty('--color-success', p.success)
  root.style.setProperty('--color-warning', p.warning)
  root.style.setProperty('--color-error', p.error)
  root.style.setProperty('--color-info', p.info)

  // Scrim overlays — dark uses black, light uses white-ish
  root.style.setProperty('--color-scrim-10', `rgba(${p.overlayChannel},0.10)`)
  root.style.setProperty('--color-scrim-15', `rgba(${p.overlayChannel},0.15)`)
  root.style.setProperty('--color-scrim-20', `rgba(${p.overlayChannel},0.20)`)
  root.style.setProperty('--color-scrim-30', `rgba(${p.overlayChannel},0.30)`)
  root.style.setProperty('--color-scrim-40', `rgba(${p.overlayChannel},0.40)`)
  root.style.setProperty('--color-scrim-50', `rgba(${p.overlayChannel},0.50)`)
  root.style.setProperty('--color-scrim-60', `rgba(${p.overlayChannel},0.60)`)
  root.style.setProperty('--color-scrim-80', `rgba(${p.overlayChannel},0.80)`)

  // Scrollbar
  root.style.setProperty('--color-scroll-thumb', p.scrollThumb)
  root.style.setProperty('--color-scroll-thumb-hover', p.scrollThumbHover)

  // Accent colors (same regardless of mode — accent is user-chosen)
  const accentHover = mode === 'light' ? darkenHex(accent, 30) : darkenHex(accent, 20)
  root.style.setProperty('--color-accent', accent)
  root.style.setProperty('--color-accent-hover', accentHover)
  root.style.setProperty('--color-accent-subtle', hexToRgba(accent, 0.12))
  root.style.setProperty('--color-accent-glow', hexToRgba(accent, 0.08))
  root.style.setProperty('--color-border-accent', hexToRgba(accent, 0.30))
  // Extra opacity stops for UI elements
  root.style.setProperty('--color-accent-5', hexToRgba(accent, 0.05))
  root.style.setProperty('--color-accent-8', hexToRgba(accent, 0.08))
  root.style.setProperty('--color-accent-10', hexToRgba(accent, 0.10))
  root.style.setProperty('--color-accent-15', hexToRgba(accent, 0.15))
  root.style.setProperty('--color-accent-20', hexToRgba(accent, 0.20))
  root.style.setProperty('--color-accent-25', hexToRgba(accent, 0.25))
  root.style.setProperty('--color-accent-40', hexToRgba(accent, 0.40))
  root.style.setProperty('--color-accent-50', hexToRgba(accent, 0.50))
  root.style.setProperty('--color-accent-text', mode === 'light' ? darkenHex(accent, 40) : lightenHex(accent, 40))
  root.style.setProperty('--color-accent-text-muted', mode === 'light' ? darkenHex(accent, 20) : lightenHex(accent, 60))

  // Surface opacity (channel flips: dark = white overlays, light = black overlays)
  const so = s.surfaceOpacity
  const sc = p.surfaceChannel
  root.style.setProperty('--color-surface', `rgba(${sc},${(0.04 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-hover', `rgba(${sc},${(0.07 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-active', `rgba(${sc},${(0.10 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-raised', `rgba(${sc},${(0.05 * so).toFixed(3)})`)

  // Border opacity
  const bo = s.borderOpacity
  root.style.setProperty('--color-border', `rgba(${sc},${(0.08 * bo).toFixed(3)})`)
  root.style.setProperty('--color-border-hover', `rgba(${sc},${(0.14 * bo).toFixed(3)})`)

  // Font size
  root.style.setProperty('font-size', `${s.fontSize}px`)

  // Corner radius
  const cr = s.cornerRadius ?? 0
  root.style.setProperty('--radius-sm', `${Math.max(0, cr - 4)}px`)
  root.style.setProperty('--radius-md', `${cr}px`)
  root.style.setProperty('--radius-lg', `${cr + 4}px`)
  root.style.setProperty('--radius-xl', `${cr + 8}px`)

  // Sidebar width
  root.style.setProperty('--sidebar-width', `${s.sidebarWidth}px`)

  // Blur
  if (!s.enableBlur) {
    root.style.setProperty('--blur-strength', '0px')
  } else {
    root.style.removeProperty('--blur-strength')
  }

  // UI zoom (via main process)
  window.api.setZoomFactor(s.uiScale)

  // Background gradient on body wrapper — we store it as a data attribute for App.tsx to read
  const bgStyle = BG_STYLES[s.backgroundStyle] || BG_STYLES.default
  const bgImage = bgStyle.gradient(s.bgGradient1, s.bgGradient2, accent)
  root.style.setProperty('--app-bg-image', bgImage)

  // Background image
  if (s.bgImagePath) {
    root.style.setProperty('--app-bg-blur', `${s.bgImageBlur}px`)
    root.style.setProperty('--app-bg-opacity', String(s.bgImageOpacity))
    root.style.setProperty('--app-bg-overlay-opacity', String(1 - s.bgImageOpacity))
    // Load image async and set as CSS variable
    window.api.loadBackgroundImage(s.bgImagePath).then((dataUrl) => {
      if (dataUrl) {
        root.style.setProperty('--app-bg-image-url', `url(${dataUrl})`)
      } else {
        root.style.removeProperty('--app-bg-image-url')
      }
    })
  } else {
    root.style.removeProperty('--app-bg-image-url')
    root.style.removeProperty('--app-bg-blur')
    root.style.removeProperty('--app-bg-opacity')
    root.style.removeProperty('--app-bg-overlay-opacity')
  }

  // Accent shadow
  root.style.setProperty('--accent-shadow', `0 10px 40px ${hexToRgba(accent, 0.22)}`)
  root.style.setProperty('--accent-shadow-sm', `0 4px 20px ${hexToRgba(accent, 0.15)}`)

  // ── Visual Tweaks CSS (generated from UI settings) ──
  const tweaks: string[] = []

  // Button size
  if (s.buttonSize === 'comfortable') {
    tweaks.push(`button, [role="button"], a[class*="btn"], input[type="button"], input[type="submit"] { padding-top: 0.375rem; padding-bottom: 0.375rem; padding-left: 0.875rem; padding-right: 0.875rem; }`)
  } else if (s.buttonSize === 'large') {
    tweaks.push(`button, [role="button"], a[class*="btn"], input[type="button"], input[type="submit"] { padding-top: 0.5rem; padding-bottom: 0.5rem; padding-left: 1rem; padding-right: 1rem; font-size: 0.9375rem; }`)
  }

  // Font family
  if (s.fontFamily === 'monospace') {
    tweaks.push(`* { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace !important; }`)
  } else if (s.fontFamily === 'serif') {
    tweaks.push(`* { font-family: Georgia, 'Times New Roman', serif !important; }`)
  }

  // Scrollbar style
  if (s.scrollbarStyle === 'thin-accent') {
    tweaks.push(`::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: var(--color-accent); border-radius: 3px; } ::-webkit-scrollbar-thumb:hover { background: var(--color-accent-hover); }`)
  } else if (s.scrollbarStyle === 'hidden') {
    tweaks.push(`::-webkit-scrollbar { display: none; }`)
  } else if (s.scrollbarStyle === 'rounded') {
    tweaks.push(`::-webkit-scrollbar { width: 12px; } ::-webkit-scrollbar-track { background: var(--color-surface); border-radius: 6px; } ::-webkit-scrollbar-thumb { background: var(--color-accent-25); border-radius: 6px; border: 2px solid var(--color-surface); } ::-webkit-scrollbar-thumb:hover { background: var(--color-accent); }`)
  }

  // Animation speed
  if (s.animationSpeed === 'none') {
    tweaks.push(`*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }`)
  } else if (s.animationSpeed === 'slow') {
    tweaks.push(`*, *::before, *::after { transition-duration: 0.4s !important; }`)
  }

  // Border style
  if (s.borderStyle === 'none') {
    tweaks.push(`* { border-color: transparent !important; }`)
  } else if (s.borderStyle === 'thick') {
    tweaks.push(`.border, [class*="border-"] { border-width: 2px !important; }`)
  } else if (s.borderStyle === 'accent') {
    tweaks.push(`.border, [class*="border-"] { border-color: var(--color-accent-25) !important; }`)
  }

  // Overlay effect
  if (s.overlayEffect === 'scanlines') {
    tweaks.push(`#root::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999; background: repeating-linear-gradient(transparent 0px, rgba(0,0,0,0.03) 1px, transparent 2px); }`)
  } else if (s.overlayEffect === 'vignette') {
    tweaks.push(`#root::before { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9998; background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%); }`)
  } else if (s.overlayEffect === 'noise') {
    tweaks.push(`#root::after { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 9999; opacity: 0.03; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }`)
  }

  // Effect toggles
  if (s.effectPageFade) {
    tweaks.push(`main > div { animation: _vt_fadeIn 0.2s ease-in; } @keyframes _vt_fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }`)
  }
  if (s.effectFrostedGlass) {
    tweaks.push(`[class*="bg-[var(--color-scrim"] { backdrop-filter: blur(20px) saturate(1.5); }`)
  }
  if (s.effectAccentSelection) {
    tweaks.push(`::selection { background: var(--color-accent) !important; color: white !important; }`)
  }
  if (s.effectHoverGlow) {
    tweaks.push(`[class*="border"][class*="hover"]:hover { box-shadow: 0 0 20px var(--color-accent-25); }`)
  }
  if (s.effectHoverLift) {
    tweaks.push(`[class*="border"][class*="hover"]:hover { transform: translateY(-2px); transition: transform 0.15s ease; }`)
  }

  // Color filters
  const fb = s.filterBrightness ?? 1.0
  const fc = s.filterContrast ?? 1.0
  const fs = s.filterSaturation ?? 1.0
  if (fb !== 1.0 || fc !== 1.0 || fs !== 1.0) {
    tweaks.push(`#root { filter: brightness(${fb}) contrast(${fc}) saturate(${fs}); }`)
  }

  // Inject visual tweaks CSS
  let tweakEl = document.getElementById('visual-tweaks-css') as HTMLStyleElement | null
  if (tweaks.length > 0) {
    if (!tweakEl) {
      tweakEl = document.createElement('style')
      tweakEl.id = 'visual-tweaks-css'
      document.head.appendChild(tweakEl)
    }
    tweakEl.textContent = tweaks.join('\n')
  } else if (tweakEl) {
    tweakEl.remove()
  }

  // Legacy custom CSS injection (backward compat — not exposed in UI)
  let styleEl = document.getElementById('user-custom-css') as HTMLStyleElement | null
  if (s.customCSS && s.customCSSEnabled !== false) {
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'user-custom-css'
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = s.customCSS
  } else if (styleEl) {
    styleEl.remove()
  }
}
