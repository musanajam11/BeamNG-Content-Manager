import { UserPlus } from 'lucide-react'

interface Suggestion {
  name: string
  seenCount: number
  lastSeen: number
}

interface FriendSuggestionsProps {
  suggestions: Suggestion[]
  onAdd: (name: string) => void
}

export function FriendSuggestions({ suggestions, onAdd }: FriendSuggestionsProps): React.JSX.Element | null {
  if (suggestions.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
        Recently Played With
      </h3>
      <div className="space-y-1">
        {suggestions.slice(0, 8).map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-[var(--color-border)] hover:bg-white/8 transition-colors"
          >
            <div>
              <p className="text-sm text-[var(--color-text-primary)]">{s.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">
                Seen {s.seenCount} times
              </p>
            </div>
            <button
              onClick={() => onAdd(s.name)}
              className="p-1.5 rounded-md text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20 transition-colors"
              title={`Add ${s.name}`}
            >
              <UserPlus size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
