import { useRef, useState, useCallback, useEffect, useMemo, memo } from 'react'
import { Star, Shield, Lock, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { ServerInfo } from '../../../../shared/types'
import { countryFlag, cleanMapName } from '../../utils/countryFlags'
import { useFlagUrl } from '../../utils/flagCache'
import { BeamMPText } from '../BeamMPText'
import { parseServerTags } from '../../utils/serverTags'
import { ServerTagBadge } from './ServerTag'

interface Props {
  server: ServerInfo
  index: number
  selected: boolean
  favorite: boolean
  onSelect: () => void
  onToggleFavorite: () => void
}

function getFillPct(server: ServerInfo): number {
  const p = parseInt(server.players, 10) || 0
  const m = parseInt(server.maxplayers, 10) || 0
  if (!m) return 0
  return Math.min(100, (p / m) * 100)
}

function getPopColor(pct: number): string {
  if (pct >= 90) return 'pop-fill-rose'
  if (pct >= 65) return 'pop-fill-amber'
  return 'pop-fill-green'
}

function getServerTags(server: ServerInfo, t: TFunction): { label: string; tone: string }[] {
  const tags: { label: string; tone: string }[] = []
  const pct = getFillPct(server)
  if (server.tags === 'offline') { tags.push({ label: t('servers.tagOffline'), tone: 'offline' }); return tags }
  if (server.official) tags.push({ label: t('servers.tagOfficial'), tone: 'accent' })
  if (parseInt(server.modstotal, 10) > 0) tags.push({ label: t('servers.tagModded'), tone: 'gold' })
  if (server.password) tags.push({ label: t('servers.tagPassword'), tone: 'default' })
  if (pct >= 85) tags.push({ label: t('servers.tagHighPop'), tone: 'warn' })
  if (pct === 0) tags.push({ label: t('servers.tagEmpty'), tone: 'default' })
  return tags
}

const BADGE_TONES: Record<string, string> = {
  accent: 'border-[var(--color-accent-25)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]',
  gold: 'border-yellow-400/25 bg-yellow-400/12 text-yellow-200',
  warn: 'border-[var(--color-accent-25)] bg-[var(--color-accent-subtle)] text-[var(--color-accent-text-muted)]',
  offline: 'border-red-400/25 bg-red-400/12 text-red-300',
  default: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]',
}

function ServerListItemImpl({ server, selected, favorite, onSelect, onToggleFavorite }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const playerCount = parseInt(server.players, 10) || 0
  const maxPlayers = parseInt(server.maxplayers, 10) || 0
  const fillPct = getFillPct(server)
  // Memoize tag derivations — these allocate arrays/objects each call and are
  // re-computed on every list refresh otherwise. Recompute only when the
  // underlying server fields actually change.
  const tags = useMemo(() => getServerTags(server, t), [server, t])
  const contentTags = useMemo(() => parseServerTags(server.tags), [server.tags])
  const flagUrl = useFlagUrl(server.location)

  // Marquee: detect if server name overflows its container
  const nameContainerRef = useRef<HTMLDivElement>(null)
  const nameTextRef = useRef<HTMLSpanElement>(null)
  const [nameOverflows, setNameOverflows] = useState(false)

  const checkNameOverflow = useCallback(() => {
    const container = nameContainerRef.current
    const text = nameTextRef.current
    if (!container || !text) return
    const overflow = text.scrollWidth > container.clientWidth
    setNameOverflows(overflow)
    if (overflow) {
      text.style.setProperty('--marquee-offset', `${container.clientWidth - text.scrollWidth}px`)
    }
  }, [])

  useEffect(() => {
    // Initial check after layout settles. We deliberately skip a per-row
    // ResizeObserver — the row width only changes on window resize (the parent
    // list isn't user-resizable), so a single window listener is enough and
    // avoids hundreds of observers on a 500-server list.
    checkNameOverflow()
    const onResize = (): void => checkNameOverflow()
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [server.sname, checkNameOverflow])

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group w-full border-b px-5 py-2 text-left transition ${
        selected
          ? 'border-[var(--color-border-accent)] bg-[var(--color-accent-8)]'
          : 'border-[var(--color-border)] bg-transparent hover:bg-[var(--color-surface)]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        {/* Star + Flag */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
            className={`p-0.5 transition ${
              favorite ? 'text-yellow-300' : 'text-[var(--color-text-dim)] hover:text-yellow-300'
            }`}
          >
            <Star size={12} fill={favorite ? 'currentColor' : 'none'} />
          </button>
          {flagUrl ? (
            <img
              src={flagUrl}
              alt={server.location}
              className="w-5 h-3.5 object-cover shadow-sm"
            />
          ) : (
            <span className="text-xs leading-none">{countryFlag(server.location)}</span>
          )}
        </div>

        {/* Name + icons */}
        <div ref={nameContainerRef} className="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">
          <span ref={nameTextRef} className={`marquee-scroll${nameOverflows ? ' is-overflowing' : ''}`}>
            <BeamMPText text={server.sname} className="text-xs font-semibold text-[var(--color-text-primary)] whitespace-nowrap" />
          </span>
          {server.official && <Shield size={10} className="shrink-0 text-[var(--color-accent)]" />}
          {server.password && <Lock size={10} className="shrink-0 text-[var(--color-text-muted)]" />}
        </div>

        {/* Tags (inline) */}
        <div className="flex items-center gap-1 shrink-0">
          {tags.slice(0, 1).map((tag) => (
            <span key={tag.label} className={`inline-flex items-center border px-1.5 py-0 text-[9px] font-medium ${BADGE_TONES[tag.tone]}`}>
              {tag.label}
            </span>
          ))}
          {contentTags.slice(0, 2).map((ct) => (
            <ServerTagBadge key={ct.id} tag={ct} compact />
          ))}
          {contentTags.length > 2 && (
            <span className="text-[9px] text-[var(--color-text-muted)] font-medium">+{contentTags.length - 2}</span>
          )}
        </div>

        {/* Map */}
        <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)] inline-flex items-center gap-1 w-28 truncate">
          <MapPin size={9} />{cleanMapName(server.map)}
        </span>

        {/* Players */}
        <span className="shrink-0 text-[11px] text-[var(--color-text-secondary)] w-14 text-right font-medium">
          {playerCount}/{maxPlayers}
        </span>

        {/* Pop bar */}
        <div className="shrink-0 w-16">
          <div className="pop-bar">
            <div className={`pop-bar-fill ${getPopColor(fillPct)}`} style={{ width: `${fillPct}%` }} />
          </div>
        </div>
      </div>
    </button>
  )
}

// Memoized so the 30-second auto-refresh of the server list doesn't re-render
// every row when the underlying values are unchanged. We compare the fields
// that actually drive the JSX; identity changes on the parent's onSelect /
// onToggleFavorite callbacks are intentionally ignored (they're recreated each
// render but always do the same thing for this row).
export const ServerListItem = memo(ServerListItemImpl, (prev, next) => {
  if (prev.selected !== next.selected) return false
  if (prev.favorite !== next.favorite) return false
  const a = prev.server, b = next.server
  return (
    a.ip === b.ip &&
    a.port === b.port &&
    a.players === b.players &&
    a.maxplayers === b.maxplayers &&
    a.sname === b.sname &&
    a.tags === b.tags &&
    a.official === b.official &&
    a.password === b.password &&
    a.map === b.map &&
    a.location === b.location &&
    a.modstotal === b.modstotal
  )
})
