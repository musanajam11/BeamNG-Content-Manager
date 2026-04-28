import { BrowserWindow, session, net } from 'electron'

const BMR_PARTITION = 'persist:bmr'
const BMR_DOMAIN = 'bmr.musanet.xyz'
const BMR_BASE = 'https://bmr.musanet.xyz'

export interface BmrDesktopCookie {
  name: string
  value: string
  expires: number | null
}

/**
 * Opens a real Electron window pointed at the BMR sign-in page so the user
 * can complete the Cloudflare/Turnstile challenge and log in. We poll
 * `/api/auth/me` from within the same Electron session: as soon as it
 * returns an authenticated user, we snapshot every cookie on bmr.musanet.xyz
 * and hand them back so the main BmrService can adopt the session.
 */
export async function bmrDesktopSignIn(
  parent: BrowserWindow | null,
): Promise<BmrDesktopCookie[]> {
  const bmrSession = session.fromPartition(BMR_PARTITION)
  const win = new BrowserWindow({
    width: 900,
    height: 760,
    parent: parent || undefined,
    autoHideMenuBar: true,
    title: 'BMR – Sign in',
    backgroundColor: '#111113',
    webPreferences: {
      session: bmrSession,
      sandbox: true,
    },
  })

  const isAuthenticated = (): Promise<boolean> =>
    new Promise((resolveAuth) => {
      try {
        const req = net.request({
          method: 'GET',
          url: `${BMR_BASE}/api/auth/me`,
          session: bmrSession,
          useSessionCookies: true,
        })
        let body = ''
        req.on('response', (res) => {
          if (res.statusCode !== 200) {
            res.on('data', () => {})
            res.on('end', () => resolveAuth(false))
            return
          }
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString('utf-8')
          })
          res.on('end', () => {
            try {
              const data = JSON.parse(body) as { user?: { id?: string } | null }
              resolveAuth(!!data.user && !!data.user.id)
            } catch {
              resolveAuth(false)
            }
          })
        })
        req.on('error', () => resolveAuth(false))
        req.end()
      } catch {
        resolveAuth(false)
      }
    })

  return new Promise<BmrDesktopCookie[]>((resolve) => {
    let resolved = false
    let pollTimer: NodeJS.Timeout | null = null

    const finish = async (cookies: BmrDesktopCookie[]): Promise<void> => {
      if (resolved) return
      resolved = true
      if (pollTimer) clearInterval(pollTimer)
      if (!win.isDestroyed()) win.close()
      resolve(cookies)
    }

    const tryCapture = async (): Promise<void> => {
      if (resolved) return
      const ok = await isAuthenticated()
      if (!ok) return
      const all = await bmrSession.cookies.get({ domain: BMR_DOMAIN })
      const mapped: BmrDesktopCookie[] = all.map((c) => ({
        name: c.name,
        value: c.value,
        expires:
          typeof c.expirationDate === 'number' ? Math.round(c.expirationDate * 1000) : null,
      }))
      await finish(mapped)
    }

    // Re-check on every navigation / load event the page emits.
    const navHandler = (): void => {
      void tryCapture()
    }
    win.webContents.on('did-navigate', navHandler)
    win.webContents.on('did-navigate-in-page', navHandler)
    win.webContents.on('did-finish-load', navHandler)
    win.webContents.on('did-frame-finish-load', navHandler)

    // Continuous polling — covers SPA flows where no nav event fires after
    // the auth API call resolves.
    pollTimer = setInterval(() => {
      void tryCapture()
    }, 1500)

    win.on('closed', () => {
      if (!resolved) void finish([])
    })

    void win.loadURL(`${BMR_BASE}/login`)
  })
}

/**
 * Wipe the persistent Electron session used by the sign-in window. Called
 * when the user signs out so the next sign-in attempt actually shows the
 * login form instead of silently re-authenticating from leftover cookies.
 */
export async function bmrDesktopSignOut(): Promise<void> {
  try {
    const bmrSession = session.fromPartition(BMR_PARTITION)
    await bmrSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    })
  } catch {
    /* best-effort */
  }
}

