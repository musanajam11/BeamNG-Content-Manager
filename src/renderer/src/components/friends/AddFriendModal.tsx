import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface AddFriendModalProps {
  open: boolean
  onClose: () => void
  onAdd: (username: string) => void
  existingIds: Set<string>
}

export function AddFriendModal({ open, onClose, onAdd, existingIds }: AddFriendModalProps): React.JSX.Element | null {
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const { t } = useTranslation()

  if (!open) return null

  const handleAdd = (): void => {
    const trimmed = username.trim()
    if (!trimmed) {
      setError(t('friends.enterUsername'))
      return
    }
    if (existingIds.has(trimmed.toLowerCase())) {
      setError(t('friends.alreadyInList'))
      return
    }
    onAdd(trimmed)
    setUsername('')
    setError('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <UserPlus size={18} className="text-[var(--color-accent)]" />
            {t('friends.addFriend')}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          {t('friends.enterBeamMPUsername')}
        </p>

        <input
          type="text"
          value={username}
          onChange={(e) => { setUsername(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder={t('friends.beammpUsernamePlaceholder')}
          className="w-full px-3 py-2 rounded-lg bg-black/20 border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent)] mb-2"
          autoFocus
        />

        {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleAdd}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white font-medium hover:brightness-110 transition-all"
          >
            {t('friends.addFriend')}
          </button>
        </div>
      </div>
    </div>
  )
}
