import { create } from 'zustand'
import type { AppearanceSettings, AppPage } from '../../../shared/types'

export const DEFAULT_SIDEBAR_ORDER: AppPage[] = [
  'home', 'servers', 'friends', 'vehicles', 'maps', 'mods',
  'career', 'server-admin', 'launcher', 'controls'
]

const DEFAULT_APPEARANCE: AppearanceSettings = {
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
  customCSSEnabled: true
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
  load: (settings: AppearanceSettings) => void
  update: (partial: Partial<AppearanceSettings>) => Promise<void>
  reset: () => Promise<void>
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
  appearance: { ...DEFAULT_APPEARANCE },
  loaded: false,

  load: (settings: AppearanceSettings) => {
    const merged = { ...DEFAULT_APPEARANCE, ...settings }
    // Cycle background on launch if enabled
    if (merged.bgCycleOnLaunch && merged.bgImageList.length > 0) {
      const randomIndex = Math.floor(Math.random() * merged.bgImageList.length)
      merged.bgImagePath = merged.bgImageList[randomIndex]
      // Persist the randomly selected background
      window.api.updateConfig({ appearance: merged })
    }
    set({ appearance: merged, loaded: true })
    applyTheme(merged)
  },

  update: async (partial: Partial<AppearanceSettings>) => {
    const next = { ...get().appearance, ...partial }
    set({ appearance: next })
    applyTheme(next)
    // Persist to config
    await window.api.updateConfig({ appearance: next })
  },

  reset: async () => {
    const defaults = { ...DEFAULT_APPEARANCE }
    set({ appearance: defaults })
    applyTheme(defaults)
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
function applyTheme(s: AppearanceSettings): void {
  const root = document.documentElement
  const accent = s.accentColor
  const accentHover = darkenHex(accent, 20)

  // Accent colors
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
  root.style.setProperty('--color-accent-text', lightenHex(accent, 40))
  root.style.setProperty('--color-accent-text-muted', lightenHex(accent, 60))

  // Surface opacity
  const so = s.surfaceOpacity
  root.style.setProperty('--color-surface', `rgba(255,255,255,${(0.04 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-hover', `rgba(255,255,255,${(0.07 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-active', `rgba(255,255,255,${(0.10 * so).toFixed(3)})`)
  root.style.setProperty('--color-surface-raised', `rgba(255,255,255,${(0.05 * so).toFixed(3)})`)

  // Border opacity
  const bo = s.borderOpacity
  root.style.setProperty('--color-border', `rgba(255,255,255,${(0.08 * bo).toFixed(3)})`)
  root.style.setProperty('--color-border-hover', `rgba(255,255,255,${(0.14 * bo).toFixed(3)})`)

  // Font size
  root.style.setProperty('font-size', `${s.fontSize}px`)

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

  // Custom CSS injection
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
