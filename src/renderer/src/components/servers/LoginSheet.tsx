import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export function LoginSheet({ onClose, onSuccess }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (): Promise<void> => {
    if (!loginUser || !loginPass) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.beammpLogin(loginUser, loginPass)
      if (result.success) {
        onSuccess()
        onClose()
      } else {
        setError(result.error || 'Login failed')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleGuest = async (): Promise<void> => {
    await window.api.beammpLoginAsGuest()
    onSuccess()
    onClose()
  }

  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-scrim-20)] p-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={loginUser}
          onChange={(e) => setLoginUser(e.target.value)}
          placeholder={t('servers.username')}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-40)]"
        />
        <input
          type="password"
          value={loginPass}
          onChange={(e) => setLoginPass(e.target.value)}
          placeholder={t('servers.password')}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          className="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-40)]"
        />
        <button
          onClick={handleLogin}
          disabled={loading}
          className="rounded-xl bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text-primary)] hover:opacity-90 disabled:opacity-40"
        >
          {loading ? '...' : t('servers.login')}
        </button>
        <button
          onClick={handleGuest}
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-active)]"
        >
          {t('common.guest')}
        </button>
      </div>
      {error && <p className="mt-1.5 px-1 text-[10px] text-rose-400">{error}</p>}
    </div>
  )
}
