import type { HostedServerEntry } from '../../../../shared/types'
import { ServerInstanceCard } from './ServerInstanceCard'

interface ServerInstanceListProps {
  servers: HostedServerEntry[]
  selectedId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string, name: string) => void
  onStart: (id: string) => void
  onStop: (id: string) => void
}

export function ServerInstanceList({
  servers,
  selectedId,
  onSelect,
  onDelete,
  onStart,
  onStop
}: ServerInstanceListProps): React.JSX.Element {
  return (
    <div className="w-[220px] shrink-0 flex flex-col border border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto">
      {servers.length === 0 ? (
        <div className="p-4 text-xs text-[var(--color-text-muted)] text-center">
          No servers yet
        </div>
      ) : (
        servers.map((s) => (
          <ServerInstanceCard
            key={s.config.id}
            server={s}
            isSelected={selectedId === s.config.id}
            onSelect={onSelect}
            onDelete={onDelete}
            onStart={onStart}
            onStop={onStop}
          />
        ))
      )}
    </div>
  )
}
