import { UserMinus, ExternalLink, Copy, MapPin, Users, AlertTriangle } from 'lucide-react'
import type { Friend, FriendOnlineStatus } from '../../stores/useFriendsStore'

interface FriendCardProps {
  friend: Friend
  status?: FriendOnlineStatus
  onRemove: (id: string) => void
  onJoinServer?: (ident: string) => void
}

/** Strip BeamMP color codes from server name */
function stripColors(text: string): string {
  return text.replace(/\^[0-9a-fA-FlLrR]/g, '').trim()
}

function timeAgo(timestamp: number | undefined): string {
  if (!timestamp) return 'Never seen'
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function FriendCard({ friend, status, onRemove, onJoinServer }: FriendCardProps): React.JSX.Element {
  const online = status?.online ?? false
  const serverFull =
    online &&
    status?.serverPlayers !== undefined &&
    status?.serverMaxPlayers !== undefined &&
    status.serverMaxPlayers > 0 &&
    status.serverPlayers >= status.serverMaxPlayers

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
      online
        ? 'bg-emerald-500/5 border-emerald-500/20'
        : 'bg-white/5 border-[var(--color-border)]'
    }`}>
      {/* Online indicator */}
      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
        online ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-slate-600'
      }`} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">
          {friend.displayName}
        </p>
        {online && status?.serverName ? (
          <div className="flex items-center gap-1 mt-0.5">
            <MapPin size={10} className="text-emerald-400 shrink-0" />
            <p className="text-xs text-emerald-400 truncate">
              {stripColors(status.serverName)}
            </p>
            {status.serverMap && (
              <span className="text-xs text-[var(--color-text-muted)] truncate ml-1">
                — {status.serverMap.split('/').pop()}
              </span>
            )}
            {status.serverPlayers !== undefined && status.serverMaxPlayers !== undefined && (
              <span className={`flex items-center gap-0.5 text-xs ml-1.5 shrink-0 ${
                serverFull ? 'text-amber-400' : 'text-[var(--color-text-muted)]'
              }`}>
                <Users size={10} />
                {status.serverPlayers}/{status.serverMaxPlayers}
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            {timeAgo(status?.lastSeen)}
          </p>
        )}
        {friend.notes && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 italic truncate">
            {friend.notes}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {online && status?.serverIdent && (
          <>
            {serverFull ? (
              <span
                className="p-1.5 rounded-md text-amber-400/70 cursor-not-allowed"
                title={`Server full (${status.serverPlayers}/${status.serverMaxPlayers})`}
              >
                <AlertTriangle size={14} />
              </span>
            ) : (
              <button
                onClick={() => onJoinServer?.(status.serverIdent!)}
                className="p-1.5 rounded-md text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                title="Join server"
              >
                <ExternalLink size={14} />
              </button>
            )}
            <button
              onClick={() => navigator.clipboard.writeText(status.serverIdent!)}
              className="p-1.5 rounded-md text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              title="Copy server address"
            >
              <Copy size={14} />
            </button>
          </>
        )}
        <button
          onClick={() => onRemove(friend.id)}
          className="p-1.5 rounded-md text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition-colors"
          title="Remove friend"
        >
          <UserMinus size={14} />
        </button>
      </div>
    </div>
  )
}
