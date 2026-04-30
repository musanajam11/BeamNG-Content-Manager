/**
 * Robust clipboard write for the renderer.
 *
 * `navigator.clipboard.writeText` silently rejects in Electron when the
 * document doesn't have focus (common with custom titlebar / when the click
 * comes from a button that briefly steals focus). We therefore prefer the
 * native Electron clipboard exposed via preload, and fall back to the web
 * API + a textarea-based execCommand path so the helper still works in the
 * web build (`dist-web`) where `window.api` doesn't exist.
 */
export function copyText(text: string): boolean {
  const value = String(text ?? '')

  // Prefer Electron's native clipboard — synchronous, unaffected by focus.
  try {
    const apiRef = (globalThis as unknown as { api?: { writeClipboard?: (s: string) => boolean } }).api
    if (apiRef?.writeClipboard) {
      const ok = apiRef.writeClipboard(value)
      if (ok) return true
    }
  } catch (err) {
    console.warn('[clipboard] native write failed, falling back:', err)
  }

  // Web build / fallback: try the async clipboard API. Don't await — caller
  // is fire-and-forget.
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).catch((err) => {
        console.warn('[clipboard] navigator.clipboard rejected:', err)
        legacyExecCopy(value)
      })
      return true
    }
  } catch (err) {
    console.warn('[clipboard] navigator.clipboard threw:', err)
  }

  return legacyExecCopy(value)
}

function legacyExecCopy(value: string): boolean {
  if (typeof document === 'undefined') return false
  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (err) {
    console.error('[clipboard] legacy execCommand copy failed:', err)
    return false
  }
}
