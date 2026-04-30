// Auto-stub fallback used by the web demo's mock API Proxy.
//
// The renderer code references hundreds of `window.api.*` methods. The web
// demo can never realistically implement all of them, so we wrap the mock
// object in a Proxy that auto-generates a safe stub for any missing key.
//
// Heuristics (matched in order):
//   • on*(cb)              → listener registration; returns an unsubscribe
//                            function and never invokes the callback.
//   • get*, list*, fetch*, • Promise-returning getters; resolve to a typed
//     load*, query*, find*    empty value (null / [] / {}).
//   • probe*, check*       → resolve to `{ online: false }` / `false`.
//   • everything else      → resolve to `{ success: false, error: 'Demo
//                            mode — feature unavailable in web demo.' }`.
//
// In all cases nothing throws, so the React app can render even when a
// page reaches for a not-yet-mocked endpoint.

const PROMISE_EMPTY_ARRAY = /^(get(All|List|Sessions|Backups|Plugins|Files|Friends|Recent|Favorites|Categories|Devices|Actions|Categories|Bindings|POIs|Logs|Routes|Mods|Backgrounds)|list|find|search|browse)/i
const PROMISE_NULL = /^(get(Preview|Detail|Status|Image|Metadata|Heightmap|Minimap|TerrainBase|TerrainInfo|ConfigData|Path|Default|Health))/i
const PROMISE_BOOL_FALSE = /^(is|has|check|verify)/i
const SEND_VOID = /^(set|send|push|notify|update|toggle|save|write|delete|remove|clear|reset|open|close|hide|show|focus|blur|disable|enable|start|stop|restart|launch|kill|select|cancel|approve|reject|accept|deny|trigger|emit|register|unregister|deploy|undeploy|install|uninstall|track|record|reveal|simulate|export|import|extract|copy|move|rename|duplicate|create|add|increment|decrement|mark|backup|restore|join|leave|connect|disconnect|sign|login|logout|signup|signin|signout|browse|fetch|warm|refresh|reload|sync|generate|regenerate|render|copy|paste|undo|redo|persist|forget|edit|use|run|invoke|tick|ping|pong|seek|playPause|setUseOfficialBackend|setBackendUrl|setAuthUrl|setZoomFactor|markSetupComplete)/i

export interface AutoStubOptions {
  /** Logged whenever an unknown API key is touched (deduped). */
  onMiss?: (key: string) => void
}

export function createAutoStub(target: Record<string, unknown>, opts: AutoStubOptions = {}): Record<string, unknown> {
  const reported = new Set<string>()
  const stubCache = new Map<string, unknown>()

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop in obj) return Reflect.get(obj, prop, receiver)
      if (typeof prop !== 'string') return undefined
      if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined // not a thenable
      if (prop.startsWith('__') || prop === 'constructor') return undefined

      const cached = stubCache.get(prop)
      if (cached) return cached

      if (!reported.has(prop)) {
        reported.add(prop)
        opts.onMiss?.(prop)
      }

      const stub = makeStub(prop)
      stubCache.set(prop, stub)
      return stub
    }
  })
}

function makeStub(key: string): (...args: unknown[]) => unknown {
  // Listener registration: returns an unsubscribe function.
  if (/^on[A-Z]/.test(key)) {
    return () => () => {}
  }

  // Promise-returning getters that should resolve to []
  if (PROMISE_EMPTY_ARRAY.test(key)) {
    return async () => []
  }

  // Promise-returning getters that should resolve to null
  if (PROMISE_NULL.test(key)) {
    return async () => null
  }

  // Predicate getters
  if (PROMISE_BOOL_FALSE.test(key)) {
    return async () => false
  }

  // Side-effect / mutation methods → resolve with a soft-failure envelope
  if (SEND_VOID.test(key)) {
    return async () => ({ success: false, error: 'Demo mode — feature unavailable in web demo.' })
  }

  // Default: resolve to undefined to avoid surprising ".data" access errors.
  return async () => undefined
}
