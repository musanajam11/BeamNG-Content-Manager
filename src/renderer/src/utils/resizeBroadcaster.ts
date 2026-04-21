// Shared, rAF-coalesced window-resize broadcaster.
//
// Background: components that need to recompute layout (e.g. detect text
// overflow for marquee) used to each attach their own `window.resize` listener.
// On a list of hundreds of rows, every resize event fires hundreds of
// callbacks, each reading `scrollWidth`/`clientWidth` (forced sync layout) and
// possibly calling setState. Dragging the window edge produced a freeze.
//
// This module attaches exactly one `window.resize` listener and fans out via
// requestAnimationFrame, so all subscribers fire at most once per frame.

type Cb = () => void

const subscribers = new Set<Cb>()
let attached = false
let pending = false

function flush(): void {
  pending = false
  for (const cb of subscribers) {
    try { cb() } catch { /* keep firing the rest */ }
  }
}

function onResize(): void {
  if (pending) return
  pending = true
  requestAnimationFrame(flush)
}

function ensureAttached(): void {
  if (attached) return
  attached = true
  window.addEventListener('resize', onResize, { passive: true })
}

export function subscribeWindowResize(cb: Cb): () => void {
  ensureAttached()
  subscribers.add(cb)
  return () => { subscribers.delete(cb) }
}
