import { useState } from 'react'
import { Plug } from 'lucide-react'

interface Props {
  onConnect: (ip: string, port: string) => void
  joining: boolean
}

export function DirectConnectCard({ onConnect, joining }: Props): React.JSX.Element {
  const [address, setAddress] = useState('')

  const handleConnect = (): void => {
    const [ip, port] = address.split(':')
    if (ip && port) onConnect(ip, port)
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
        placeholder="ip:port"
        className="w-36 bg-white/5 border border-white/[0.06] rounded-xl px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]/50 focus:outline-none focus:border-[var(--accent)]/40 focus:ring-1 focus:ring-[var(--accent)]/20 transition-all font-mono"
      />
      <button
        onClick={handleConnect}
        disabled={joining || !address.includes(':')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/[0.06] text-sm text-[var(--text-secondary)] hover:bg-white/10 hover:text-[var(--text-primary)] transition-all disabled:opacity-40"
      >
        <Plug size={14} />
        Connect
      </button>
    </div>
  )
}
