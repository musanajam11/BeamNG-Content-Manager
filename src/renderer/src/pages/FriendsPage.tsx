import { Users, UserPlus, Wifi, WifiOff, Construction, Network } from 'lucide-react'

export function FriendsPage(): React.JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="relative">
        <Users size={64} className="text-[var(--color-accent)] opacity-40" />
        <Construction
          size={24}
          className="absolute -bottom-1 -right-1 text-amber-400"
        />
      </div>

      <div className="space-y-2 max-w-md">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Friends</h1>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          This feature is under development. The friends system will let you:
        </p>
      </div>

      <div className="grid gap-3 max-w-sm w-full text-left">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <UserPlus size={18} className="text-[var(--color-accent)] mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Add friends from recent sessions</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Players you&apos;ve driven with will appear as suggestions
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Wifi size={18} className="text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">See who&apos;s online</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Check which server your friends are playing on
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <WifiOff size={18} className="text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Future integrations</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              BeamMP friend lists or BeamNG follow system when available
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-[var(--color-border)]">
          <Network size={18} className="text-blue-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-[var(--color-text-primary)]">Tailscale direct connect</p>
            <p className="text-xs text-[var(--color-text-muted)]">
              See friends on your Tailnet and join their servers directly via private network
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20">
        <span className="text-xs font-medium text-amber-400">Coming Soon</span>
      </div>
    </div>
  )
}
