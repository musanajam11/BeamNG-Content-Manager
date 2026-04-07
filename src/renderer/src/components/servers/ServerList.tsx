import type { ServerInfo } from '../../../../shared/types'
import { useTranslation } from 'react-i18next'
import { ServerListItem } from './ServerListItem'

interface Props {
  servers: ServerInfo[]
  selectedServer: ServerInfo | null
  favorites: Set<string>
  onSelect: (server: ServerInfo | null) => void
  onToggleFavorite: (ident: string) => void
}

export function ServerList({
  servers,
  selectedServer,
  favorites,
  onSelect,
  onToggleFavorite
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  if (servers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500 text-sm">
        {t('servers.noServersFound')}
      </div>
    )
  }

  const selectedKey = selectedServer ? `${selectedServer.ip}:${selectedServer.port}` : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-white">{t('servers.activeServerList')}</div>
          <div className="text-[11px] text-slate-400">{t('servers.selectServerPrompt')}</div>
        </div>
        <span className="inline-flex items-center rounded-full border border-white/8 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300">
          {t('servers.results', { count: servers.length })}
        </span>
      </div>

      {/* Server rows */}
      <div
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null)
        }}
      >
        {servers.map((server, idx) => (
          <ServerListItem
            key={`${server.ip}:${server.port}`}
            server={server}
            index={idx}
            selected={selectedKey === `${server.ip}:${server.port}`}
            favorite={favorites.has(`${server.ip}:${server.port}`)}
            onSelect={() => onSelect(server)}
            onToggleFavorite={() => onToggleFavorite(`${server.ip}:${server.port}`)}
          />
        ))}
      </div>
    </div>
  )
}
