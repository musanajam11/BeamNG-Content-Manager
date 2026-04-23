import { useEffect, useRef, useState } from 'react'
import type { ServerInfo } from '../../../../shared/types'
import { useTranslation } from 'react-i18next'
import { ServerListItem } from './ServerListItem'
import { useThemeStore } from '../../stores/useThemeStore'

interface Props {
  servers: ServerInfo[]
  selectedServer: ServerInfo | null
  favorites: Set<string>
  onSelect: (server: ServerInfo | null) => void
  onToggleFavorite: (ident: string) => void
}

// When the user scrolls within this many pixels of the bottom of the list, the
// next chunk of rows is mounted. A small threshold keeps it feeling like a
// regular long list — by the time you reach the bottom, more is already there.
const NEAR_BOTTOM_PX = 600

export function ServerList({
  servers,
  selectedServer,
  favorites,
  onSelect,
  onToggleFavorite
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const chunkSize = useThemeStore((s) => s.appearance.serverListChunkSize ?? 250)
  const scrollRef = useRef<HTMLDivElement>(null)
  // How many of `servers` are currently mounted. Grows in chunk-sized steps as
  // the user scrolls; resets when the underlying list changes (filter/refresh).
  const [renderCount, setRenderCount] = useState(() => Math.min(chunkSize, servers.length))

  // Reset the visible window when the list contents or chunk size change.
  // Without this, switching from a filtered (small) list back to "All" would
  // start with a tiny render window.
  useEffect(() => {
    setRenderCount(Math.min(chunkSize, servers.length))
    // Also scroll back to the top — otherwise the scroll position can be past
    // the new list's content and the user sees an empty area.
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [servers, chunkSize])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        if (distanceFromBottom < NEAR_BOTTOM_PX) {
          setRenderCount((prev) => {
            if (prev >= servers.length) return prev
            return Math.min(servers.length, prev + chunkSize)
          })
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [servers.length, chunkSize])

  if (servers.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
        {t('servers.noServersFound')}
      </div>
    )
  }

  const selectedKey = selectedServer ? `${selectedServer.ip}:${selectedServer.port}` : null
  const visible = servers.slice(0, renderCount)
  const remaining = servers.length - renderCount

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
        <div>
          <div className="text-sm font-semibold text-[var(--color-text-primary)]">{t('servers.activeServerList')}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">{t('servers.selectServerPrompt')}</div>
        </div>
        <span className="inline-flex items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
          {t('servers.results', { count: servers.length })}
        </span>
      </div>

      {/* Server rows — chunk-loaded as the user scrolls. */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onClick={(e) => {
          if (e.target === e.currentTarget) onSelect(null)
        }}
      >
        {visible.map((server, idx) => (
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
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setRenderCount((prev) => Math.min(servers.length, prev + chunkSize))}
            className="w-full px-5 py-3 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-surface)] transition-colors text-center border-t border-[var(--color-border)]"
          >
            {t('servers.loadMore', { count: Math.min(chunkSize, remaining), remaining })}
          </button>
        )}
      </div>
    </div>
  )
}
