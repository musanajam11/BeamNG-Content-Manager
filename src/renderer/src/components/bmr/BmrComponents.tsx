// BMR (BeamNG Mod Registry @ bmr.musanet.xyz) integration components.
//
// Self-contained module: auth context, sign-in modal with Cloudflare
// Turnstile, interactive star rating, and the faceted filter panel. All
// HTTP runs in the main process via window.api.bmr*; this file is purely
// presentation + state.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Star,
  X,
  ShieldCheck,
} from 'lucide-react'
import type {
  BmrAuthState,
  BmrFacets,
  BmrPublicConfig,
  BmrUser,
} from '../../../../shared/bmr-types'

// ─────────────────────────────────────────────────────────────────────
// Auth context
// ─────────────────────────────────────────────────────────────────────

interface BmrAuthContextValue {
  signedIn: boolean
  user: BmrUser | null
  /** Public registry config (Turnstile site key, email-verify policy). */
  config: BmrPublicConfig | null
  loading: boolean
  /** Re-fetches /auth/me; updates context. */
  refresh: () => Promise<void>
  /** Returns null on success, error code string on failure. */
  signIn: (input: { email: string; password: string; turnstile_token?: string }) => Promise<string | null>
  /** Returns null on success, error code string on failure. */
  signUp: (input: { email: string; password: string; display_name: string; turnstile_token?: string }) => Promise<string | null>
  signOut: () => Promise<void>
  resendVerification: () => Promise<boolean>
}

const BmrAuthContext = createContext<BmrAuthContextValue | null>(null)

export function BmrAuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<BmrAuthState>({ signedIn: false, user: null })
  const [config, setConfig] = useState<BmrPublicConfig | null>(null)
  const [loading, setLoading] = useState(true)

  // Initial bootstrap: hydrate cached auth state + fetch public config.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const initial = await window.api.bmrGetAuthState()
        if (!cancelled) setState(initial)
        const cfg = await window.api.bmrGetPublicConfig()
        if (!cancelled && cfg.ok && cfg.data) setConfig(cfg.data)
        const me = await window.api.bmrRefreshMe()
        if (!cancelled) setState(me.state)
      } catch {
        /* offline at boot — keep defaults */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    const r = await window.api.bmrRefreshMe()
    setState(r.state)
  }, [])

  const signIn = useCallback(
    async (input: { email: string; password: string; turnstile_token?: string }) => {
      const r = await window.api.bmrLogin(input)
      setState(r.state)
      return r.result.ok ? null : r.result.error || 'login_failed'
    },
    []
  )

  const signUp = useCallback(
    async (input: { email: string; password: string; display_name: string; turnstile_token?: string }) => {
      const r = await window.api.bmrSignup(input)
      setState(r.state)
      return r.result.ok ? null : r.result.error || 'signup_failed'
    },
    []
  )

  const signOut = useCallback(async () => {
    const r = await window.api.bmrLogout()
    setState(r.state)
  }, [])

  const resendVerification = useCallback(async () => {
    const r = await window.api.bmrResendVerification()
    return r.ok
  }, [])

  const value = useMemo<BmrAuthContextValue>(
    () => ({
      signedIn: state.signedIn,
      user: state.user,
      config,
      loading,
      refresh,
      signIn,
      signUp,
      signOut,
      resendVerification,
    }),
    [state, config, loading, refresh, signIn, signUp, signOut, resendVerification]
  )

  return <BmrAuthContext.Provider value={value}>{children}</BmrAuthContext.Provider>
}

export function useBmrAuth(): BmrAuthContextValue {
  const ctx = useContext(BmrAuthContext)
  if (!ctx) throw new Error('useBmrAuth must be used inside <BmrAuthProvider>')
  return ctx
}

// ─────────────────────────────────────────────────────────────────────
// Cloudflare Turnstile widget
// ─────────────────────────────────────────────────────────────────────

interface TurnstileGlobal {
  render: (
    container: HTMLElement,
    opts: {
      sitekey: string
      theme?: 'light' | 'dark' | 'auto'
      callback?: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
    }
  ) => string
  remove: (widgetId: string) => void
  reset: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileGlobal
  }
}

const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
let turnstileScriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (turnstileScriptPromise) return turnstileScriptPromise
  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('turnstile_load_failed')))
      return
    }
    const s = document.createElement('script')
    s.src = TURNSTILE_SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('turnstile_load_failed'))
    document.head.appendChild(s)
  })
  return turnstileScriptPromise
}

function TurnstileWidget({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string
  onToken: (token: string | null) => void
  /** Bump this number to force the widget to reset (e.g. after a failed submit). */
  resetSignal: number
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  useEffect(() => {
    let cancelled = false
    setError(null)
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        // Tear down any prior render before re-rendering for a new key.
        if (widgetIdRef.current) {
          try {
            window.turnstile.remove(widgetIdRef.current)
          } catch {
            /* ignore */
          }
          widgetIdRef.current = null
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => {
            setError('turnstile_error')
            onTokenRef.current(null)
          },
        })
      })
      .catch(() => {
        if (!cancelled) setError('turnstile_load_failed')
      })
    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  // External reset (e.g. after a failed login the token is single-use).
  useEffect(() => {
    if (resetSignal === 0) return
    if (widgetIdRef.current && window.turnstile) {
      try {
        window.turnstile.reset(widgetIdRef.current)
      } catch {
        /* ignore */
      }
    }
  }, [resetSignal])

  return (
    <div className="space-y-1">
      <div ref={containerRef} className="min-h-[65px]" />
      {error && (
        <p className="text-[11px] text-rose-400 inline-flex items-center gap-1">
          <AlertCircle size={11} /> {error}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Sign-in / sign-up modal
// ─────────────────────────────────────────────────────────────────────

type AuthTab = 'login' | 'signup'

export function BmrSignInModal({
  open,
  onClose,
  initialTab = 'login',
}: {
  open: boolean
  onClose: () => void
  initialTab?: AuthTab
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { signIn, signUp, config, resendVerification } = useBmrAuth()
  const [tab, setTab] = useState<AuthTab>(initialTab)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReset, setTurnstileReset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      // Wipe sensitive state on close so reopening starts fresh.
      setPassword('')
      setErrorCode(null)
      setInfo(null)
      setTurnstileToken(null)
    }
  }, [open])

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab, open])

  if (!open) return null

  const turnstileRequired = !!config?.turnstile_site_key

  const errorMessage = (code: string | null): string | null => {
    if (!code) return null
    const map: Record<string, string> = {
      invalid_credentials: t('mods.bmrErrors.invalidCredentials'),
      account_locked: t('mods.bmrErrors.accountLocked'),
      account_blocked: t('mods.bmrErrors.accountBlocked'),
      signup_failed: t('mods.bmrErrors.signupFailed'),
      captcha_failed: t('mods.bmrErrors.captchaFailed'),
      invalid_input: t('mods.bmrErrors.invalidInput'),
      csrf_failed: t('mods.bmrErrors.csrfFailed'),
    }
    if (map[code]) return map[code]
    if (code.startsWith('network_error')) return t('mods.bmrErrors.network')
    return code
  }

  const submit = async (): Promise<void> => {
    setErrorCode(null)
    setInfo(null)
    if (turnstileRequired && !turnstileToken) {
      setErrorCode('captcha_failed')
      return
    }
    setBusy(true)
    try {
      const err =
        tab === 'login'
          ? await signIn({ email, password, turnstile_token: turnstileToken ?? undefined })
          : await signUp({
              email,
              password,
              display_name: displayName,
              turnstile_token: turnstileToken ?? undefined,
            })
      if (err) {
        setErrorCode(err)
        setTurnstileToken(null)
        setTurnstileReset((n) => n + 1)
      } else {
        if (tab === 'signup' && config?.email_verification_required) {
          setInfo(t('mods.bmrCheckInbox'))
        } else {
          onClose()
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    !busy &&
    email.length > 3 &&
    password.length >= (tab === 'signup' ? 12 : 1) &&
    (tab === 'login' || displayName.trim().length >= 2) &&
    (!turnstileRequired || !!turnstileToken)

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-scrim-60)]"
      onClick={onClose}
    >
      <div
        className="bg-[var(--color-base)] border border-[var(--color-border)] w-[420px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-primary)] inline-flex items-center gap-2">
            <ShieldCheck size={14} className="text-[var(--color-accent-text)]" />
            {tab === 'login' ? t('mods.bmrSignIn') : t('mods.bmrCreateAccount')}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex border-b border-[var(--color-border)]">
          {(['login', 'signup'] as const).map((id) => (
            <button
              key={id}
              onClick={() => {
                setTab(id)
                setErrorCode(null)
                setInfo(null)
              }}
              className={`flex-1 px-4 py-2 text-xs font-medium transition ${
                tab === id
                  ? 'text-[var(--color-accent-text)] border-b-2 border-[var(--color-border-accent)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {id === 'login' ? t('mods.bmrTabSignIn') : t('mods.bmrTabSignUp')}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[11px] text-[var(--color-text-secondary)] leading-relaxed">
            {t('mods.bmrIntro')}
          </p>

          {tab === 'signup' && (
            <label className="block">
              <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">
                {t('mods.bmrDisplayName')}
              </span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={64}
                autoComplete="username"
                className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)]"
              />
            </label>
          )}

          <label className="block">
            <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">
              {t('mods.bmrEmail')}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)]"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] text-[var(--color-text-muted)] mb-1">
              {t('mods.bmrPassword')}
              {tab === 'signup' && (
                <span className="ml-1 text-[10px] text-[var(--color-text-dim)]">
                  {t('mods.bmrPasswordHint')}
                </span>
              )}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)]"
            />
          </label>

          {turnstileRequired && config?.turnstile_site_key && (
            <TurnstileWidget
              siteKey={config.turnstile_site_key}
              onToken={setTurnstileToken}
              resetSignal={turnstileReset}
            />
          )}

          {errorMessage(errorCode) && (
            <p className="text-[11px] text-rose-400 inline-flex items-start gap-1">
              <AlertCircle size={11} className="mt-0.5 shrink-0" /> {errorMessage(errorCode)}
            </p>
          )}
          {info && (
            <p className="text-[11px] text-emerald-400 inline-flex items-start gap-1">
              <CheckCircle size={11} className="mt-0.5 shrink-0" /> {info}
              <button
                onClick={() => void resendVerification()}
                className="underline ml-1 hover:text-emerald-300"
              >
                {t('mods.bmrResendVerify')}
              </button>
            </p>
          )}

          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="w-full inline-flex items-center justify-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-3 py-2.5 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
            {tab === 'login' ? t('mods.bmrSignIn') : t('mods.bmrCreateAccount')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Header auth pill (sign in / profile dropdown)
// ─────────────────────────────────────────────────────────────────────

export function BmrAuthMenu(): React.JSX.Element {
  const { t } = useTranslation()
  const { signedIn, user, signOut, loading, refresh } = useBmrAuth()
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside.
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  if (!signedIn) {
    const handleSignIn = async (): Promise<void> => {
      setSignInError(null)
      setSigningIn(true)
      try {
        const res = await window.api.bmrDesktopSignIn()
        if (!res.ok) {
          setSignInError(t('mods.bmrErrors.invalidCredentials'))
        }
        // Pull latest auth state regardless — main already updated it.
        await refresh()
      } catch {
        setSignInError(t('mods.bmrErrors.network'))
      } finally {
        setSigningIn(false)
      }
    }
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => void handleSignIn()}
          disabled={loading || signingIn}
          className="inline-flex items-center gap-1.5 border border-[var(--color-border-accent)] bg-[var(--color-accent-10)] px-3 py-2.5 text-xs font-medium text-[var(--color-accent-text)] hover:bg-[var(--color-accent-20)] disabled:opacity-50"
          title={t('mods.bmrSignInTooltip')}
        >
          {loading || signingIn ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
          {t('mods.bmrSignIn')}
        </button>
        {signInError && (
          <span className="text-[10px] text-rose-400 inline-flex items-center gap-1">
            <AlertCircle size={10} /> {signInError}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="inline-flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-surface-active)]"
        title={user?.email ?? ''}
      >
        {user?.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full" />
        ) : (
          <span className="w-5 h-5 rounded-full bg-[var(--color-accent-20)] inline-flex items-center justify-center text-[10px] font-semibold text-[var(--color-accent-text)]">
            {(user?.display_name?.[0] ?? '?').toUpperCase()}
          </span>
        )}
        <span className="font-medium">{user?.display_name ?? t('mods.bmrSignedIn')}</span>
        <ChevronDown size={11} className={menuOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-64 border border-[var(--color-border)] bg-[var(--color-base)] shadow-xl">
          <div className="px-4 py-3 border-b border-[var(--color-border)]">
            <p className="text-xs font-medium text-[var(--color-text-primary)] truncate">
              {user?.display_name}
            </p>
            <p className="text-[10px] text-[var(--color-text-muted)] truncate">{user?.email}</p>
            {!user?.email_verified && (
              <p className="text-[10px] text-amber-400 mt-1 inline-flex items-center gap-1">
                <Mail size={10} /> {t('mods.bmrUnverified')}
              </p>
            )}
            {user?.role === 'admin' && (
              <p className="text-[10px] text-[var(--color-accent-text)] mt-1 inline-flex items-center gap-1">
                <ShieldCheck size={10} /> {t('mods.bmrAdmin')}
              </p>
            )}
          </div>
          <button
            onClick={() => {
              setMenuOpen(false)
              window.api.openModPage('https://bmr.musanet.xyz/profile')
            }}
            className="w-full text-left px-4 py-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)] hover:text-[var(--color-text-primary)]"
          >
            {t('mods.bmrOpenProfile')}
          </button>
          <button
            onClick={async () => {
              setMenuOpen(false)
              await signOut()
            }}
            className="w-full text-left px-4 py-2 text-xs text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1.5"
          >
            <LogOut size={11} /> {t('mods.bmrSignOut')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Interactive star rating (1–5 + clear)
// ─────────────────────────────────────────────────────────────────────

export function InteractiveStarRating({
  value,
  onChange,
  busy,
  size = 16,
}: {
  /** Current submitted rating, 0 if none. */
  value: number
  /** Called with 1..5 to set, or 0 to clear. */
  onChange: (next: number) => void
  busy?: boolean
  size?: number
}): React.JSX.Element {
  const [hover, setHover] = useState(0)
  const display = hover || value
  const { t } = useTranslation()
  return (
    <div className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={busy}
          onClick={() => onChange(value === n ? 0 : n)}
          onMouseEnter={() => setHover(n)}
          className="p-0.5 disabled:opacity-50 cursor-pointer transition-transform hover:scale-110"
          aria-label={`${n} stars`}
          title={value === n ? t('mods.bmrClearRating') : `${n} ★`}
        >
          <Star
            size={size}
            className={
              n <= display
                ? 'text-[var(--color-accent)] fill-[var(--color-accent)]'
                : 'text-[var(--color-text-dim)]'
            }
          />
        </button>
      ))}
      {/* Explicit clear button so the "click same star to clear" affordance
          isn't hidden — only shown once the viewer has actually rated. */}
      {value > 0 && !busy && (
        <button
          type="button"
          onClick={() => onChange(0)}
          className="ml-1 px-1 text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-pointer"
          title={t('mods.bmrClearRatingTooltip')}
          aria-label={t('mods.bmrClearRating')}
        >
          {t('mods.bmrClearRating')}
        </button>
      )}
      {busy && <Loader2 size={size - 4} className="animate-spin text-[var(--color-text-muted)] ml-1" />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Faceted filter panel
// ─────────────────────────────────────────────────────────────────────

export interface BmrFilterState {
  verified: 'any' | 'true' | 'false'
  release_status: string
  kind: string
  license: string
  multiplayer: string
  /** Currently selected tag values (lowercased). */
  tags: string[]
  tag_mode: 'all' | 'any'
  author: string
  has: string[]
  min_rating: number
}

export const EMPTY_FILTERS: BmrFilterState = {
  verified: 'any',
  release_status: '',
  kind: '',
  license: '',
  multiplayer: '',
  tags: [],
  tag_mode: 'all',
  author: '',
  has: [],
  min_rating: 0,
}

export function bmrFiltersToQuery(f: BmrFilterState): Record<string, string> {
  const out: Record<string, string> = {}
  if (f.verified !== 'any') out.verified = f.verified
  if (f.release_status) out.status = f.release_status
  if (f.kind) out.kind = f.kind
  if (f.license) out.license = f.license
  if (f.multiplayer) out.multiplayer = f.multiplayer
  if (f.tags.length > 0) {
    out.tags = f.tags.join(',')
    out.tag_mode = f.tag_mode
  }
  if (f.author) out.author = f.author
  if (f.has.length > 0) out.has = f.has.join(',')
  if (f.min_rating > 0) out.min_rating = String(f.min_rating)
  return out
}

const HAS_FIELDS = ['download', 'thumbnail', 'repository', 'homepage', 'beamng_resource'] as const

export function BmrFiltersPanel({
  facets,
  filters,
  setFilters,
  onClose,
}: {
  facets: BmrFacets | null
  filters: BmrFilterState
  setFilters: Dispatch<SetStateAction<BmrFilterState>>
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const sortedTags = useMemo(() => facets?.tags.slice(0, 60) ?? [], [facets])
  const sortedAuthors = useMemo(() => facets?.authors.slice(0, 40) ?? [], [facets])

  const setField = <K extends keyof BmrFilterState>(k: K, v: BmrFilterState[K]): void =>
    setFilters((prev) => ({ ...prev, [k]: v }))

  const toggleTag = (tag: string): void =>
    setFilters((prev) => {
      const has = prev.tags.includes(tag)
      return { ...prev, tags: has ? prev.tags.filter((x) => x !== tag) : [...prev.tags, tag] }
    })

  const toggleHas = (field: string): void =>
    setFilters((prev) => {
      const present = prev.has.includes(field)
      return { ...prev, has: present ? prev.has.filter((x) => x !== field) : [...prev.has, field] }
    })

  const reset = (): void => setFilters(EMPTY_FILTERS)

  const sectionLabel = 'block text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] mb-1.5'
  const selectCls =
    'w-full bg-[var(--color-surface)] border border-[var(--color-border)] px-2 py-1.5 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-50)]'

  return (
    <div className="shrink-0 w-[260px] border-r border-[var(--color-border)] bg-[var(--color-surface)]/40 overflow-y-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-base)] z-10">
        <span className="text-[11px] font-semibold text-[var(--color-text-primary)] uppercase tracking-widest">
          {t('mods.bmrFilters')}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={reset} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] underline">
            {t('common.reset')}
          </button>
          <button onClick={onClose} aria-label={t('common.close')} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] ml-1">
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="px-3 py-3 space-y-4">
        {/* Verified */}
        <div>
          <span className={sectionLabel}>{t('mods.bmrVerified')}</span>
          <div className="flex gap-1">
            {(['any', 'true', 'false'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setField('verified', v)}
                className={`flex-1 px-2 py-1 text-[11px] border ${
                  filters.verified === v
                    ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-10)] text-[var(--color-accent-text)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]'
                }`}
              >
                {v === 'any' ? t('common.any') : v === 'true' ? t('common.yes') : t('common.no')}
              </button>
            ))}
          </div>
        </div>

        {/* Min rating */}
        <div>
          <span className={sectionLabel}>
            {t('mods.bmrMinRating')}: {filters.min_rating > 0 ? `${filters.min_rating}★+` : t('common.any')}
          </span>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={filters.min_rating}
            onChange={(e) => setField('min_rating', Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </div>

        {/* Release status */}
        {facets && Object.keys(facets.statuses).length > 0 && (
          <div>
            <span className={sectionLabel}>{t('mods.bmrReleaseStatus')}</span>
            <select
              value={filters.release_status}
              onChange={(e) => setField('release_status', e.target.value)}
              className={selectCls}
            >
              <option value="">{t('common.any')}</option>
              {Object.entries(facets.statuses).map(([k, n]) => (
                <option key={k} value={k}>
                  {k} ({n})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Multiplayer */}
        {facets && Object.keys(facets.multiplayer).length > 0 && (
          <div>
            <span className={sectionLabel}>{t('mods.bmrMultiplayer')}</span>
            <select
              value={filters.multiplayer}
              onChange={(e) => setField('multiplayer', e.target.value)}
              className={selectCls}
            >
              <option value="">{t('common.any')}</option>
              {Object.entries(facets.multiplayer).map(([k, n]) => (
                <option key={k} value={k}>
                  {k} ({n})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Kind */}
        {facets && Object.keys(facets.kinds).length > 0 && (
          <div>
            <span className={sectionLabel}>{t('mods.bmrKind')}</span>
            <select value={filters.kind} onChange={(e) => setField('kind', e.target.value)} className={selectCls}>
              <option value="">{t('common.any')}</option>
              {Object.entries(facets.kinds).map(([k, n]) => (
                <option key={k} value={k}>
                  {k} ({n})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* License */}
        {facets && Object.keys(facets.licenses).length > 0 && (
          <div>
            <span className={sectionLabel}>{t('mods.bmrLicense')}</span>
            <select
              value={filters.license}
              onChange={(e) => setField('license', e.target.value)}
              className={selectCls}
            >
              <option value="">{t('common.any')}</option>
              {Object.entries(facets.licenses)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 30)
                .map(([k, n]) => (
                  <option key={k} value={k}>
                    {k} ({n})
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Author */}
        {sortedAuthors.length > 0 && (
          <div>
            <span className={sectionLabel}>{t('mods.bmrAuthor')}</span>
            <input
              type="text"
              value={filters.author}
              onChange={(e) => setField('author', e.target.value)}
              placeholder={t('mods.bmrAuthorPlaceholder')}
              list="bmr-author-suggestions"
              className={selectCls}
            />
            <datalist id="bmr-author-suggestions">
              {sortedAuthors.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.value} ({a.count})
                </option>
              ))}
            </datalist>
          </div>
        )}

        {/* "Has" toggles */}
        <div>
          <span className={sectionLabel}>{t('mods.bmrHas')}</span>
          <div className="space-y-1">
            {HAS_FIELDS.map((field) => (
              <label key={field} className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)] cursor-pointer hover:text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={filters.has.includes(field)}
                  onChange={() => toggleHas(field)}
                  className="accent-[var(--color-accent)]"
                />
                {t(`mods.bmrHasField.${field}`, { defaultValue: field })}
              </label>
            ))}
          </div>
        </div>

        {/* Tags */}
        {sortedTags.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-widest text-[var(--color-text-muted)]">
                {t('mods.bmrTags')}
              </span>
              <button
                onClick={() => setField('tag_mode', filters.tag_mode === 'all' ? 'any' : 'all')}
                className="text-[10px] text-[var(--color-accent-text)] hover:underline"
              >
                {filters.tag_mode === 'all' ? t('mods.bmrTagAll') : t('mods.bmrTagAny')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {sortedTags.map((tg) => {
                const active = filters.tags.includes(tg.value)
                return (
                  <button
                    key={tg.value}
                    onClick={() => toggleTag(tg.value)}
                    className={`text-[10px] px-1.5 py-0.5 border ${
                      active
                        ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-15)] text-[var(--color-accent-text)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]'
                    }`}
                    title={`${tg.value} (${tg.count})`}
                  >
                    {tg.value}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
