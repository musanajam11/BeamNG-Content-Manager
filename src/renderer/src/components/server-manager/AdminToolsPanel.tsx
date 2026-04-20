import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  Trash2
} from 'lucide-react'
import {
  CobaltEssentialsIcon,
  CEIIcon,
  RestartNotifierIcon,
  ProFilterIcon,
  QuickChatIcon
} from './PluginIcons'
import { PluginReadmeToggle } from './PluginReadme'

type PluginCompat = 'careerMP' | 'rls' | 'both' | 'beamMP'

interface PluginCatalogEntry {
  id: string
  name: string
  description: string
  author: string
  repo: string
  homepage: string
  compat: PluginCompat
  installMethod: 'extract-to-root' | 'extract-to-server-plugin' | 'copy-client-zip'
  serverPluginFolder?: string
}

interface PluginRelease {
  version: string
  name: string
  changelog: string
  prerelease: boolean
  publishedAt: string
  downloadUrl: string
  size: number
  downloads: number
}

interface InstalledPlugin {
  pluginId: string
  version: string
  installedAt: string
  artifacts: string[]
}

interface AdminToolsPanelProps {
  serverId: string
}

/**
 * Per-plugin icon + accent colour for the server-admin catalog.
 */
function adminPluginIcon(id: string): { Icon: React.ComponentType<{ size?: number; className?: string }>; className: string } {
  switch (id) {
    case 'cobalt-essentials':
      return { Icon: CobaltEssentialsIcon, className: 'text-sky-300' }
    case 'cobalt-essentials-interface':
      return { Icon: CEIIcon, className: 'text-violet-300' }
    case 'restart-notifier':
      return { Icon: RestartNotifierIcon, className: 'text-amber-300' }
    case 'profilter':
      return { Icon: ProFilterIcon, className: 'text-rose-300' }
    case 'beammp-quick-chat':
      return { Icon: QuickChatIcon, className: 'text-emerald-300' }
    default:
      return { Icon: Package, className: 'text-[var(--color-accent)]' }
  }
}

export function AdminToolsPanel({ serverId }: AdminToolsPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([])
  const [releasesByPlugin, setReleasesByPlugin] = useState<Record<string, PluginRelease[]>>({})
  const [selectedVersionByPlugin, setSelectedVersionByPlugin] = useState<Record<string, string>>({})
  const [installed, setInstalled] = useState<Record<string, InstalledPlugin>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [msg, setMsg] = useState<Record<string, { type: 'success' | 'error'; text: string }>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadCatalog = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.serverAdminListPluginCatalog()
      setCatalog(list)
      const results = await Promise.all(
        list.map(async (p) => {
          try {
            const r = await window.api.serverAdminFetchPluginReleases(p.id)
            return [p.id, r] as const
          } catch {
            return [p.id, [] as PluginRelease[]] as const
          }
        })
      )
      const map: Record<string, PluginRelease[]> = {}
      const sel: Record<string, string> = {}
      for (const [id, rels] of results) {
        map[id] = rels
        if (rels.length > 0) sel[id] = rels[0].version
      }
      setReleasesByPlugin(map)
      setSelectedVersionByPlugin(sel)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshInstalled = useCallback(async () => {
    if (!serverId) {
      setInstalled({})
      return
    }
    try {
      const inst = await window.api.serverAdminGetInstalledPlugins(serverId)
      setInstalled(inst)
    } catch {
      setInstalled({})
    }
  }, [serverId])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])
  useEffect(() => {
    refreshInstalled()
  }, [refreshInstalled])

  const handleInstall = useCallback(
    async (entry: PluginCatalogEntry) => {
      if (!serverId) {
        setMsg((m) => ({
          ...m,
          [entry.id]: { type: 'error', text: t('serverManager.adminTools.noServer') }
        }))
        return
      }
      const version = selectedVersionByPlugin[entry.id]
      const release = (releasesByPlugin[entry.id] || []).find((r) => r.version === version)
      if (!release) return
      setBusy((b) => ({ ...b, [entry.id]: true }))
      setMsg((m) => {
        const c = { ...m }
        delete c[entry.id]
        return c
      })
      try {
        const result = await window.api.serverAdminInstallPlugin(
          entry.id,
          release.version,
          release.downloadUrl,
          serverId
        )
        if (result.success) {
          setMsg((m) => ({
            ...m,
            [entry.id]: {
              type: 'success',
              text: t('serverManager.adminTools.installSuccess', { name: entry.name })
            }
          }))
          await refreshInstalled()
        } else {
          setMsg((m) => ({
            ...m,
            [entry.id]: {
              type: 'error',
              text: result.error || t('serverManager.adminTools.installFailed')
            }
          }))
        }
      } catch (err) {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: String(err) } }))
      } finally {
        setBusy((b) => ({ ...b, [entry.id]: false }))
      }
    },
    [serverId, selectedVersionByPlugin, releasesByPlugin, refreshInstalled, t]
  )

  const handleUninstall = useCallback(
    async (entry: PluginCatalogEntry) => {
      if (!serverId) return
      setBusy((b) => ({ ...b, [entry.id]: true }))
      try {
        const result = await window.api.serverAdminUninstallPlugin(entry.id, serverId)
        if (result.success) {
          setMsg((m) => ({
            ...m,
            [entry.id]: {
              type: 'success',
              text: t('serverManager.adminTools.uninstalled', { name: entry.name })
            }
          }))
          await refreshInstalled()
        } else {
          setMsg((m) => ({
            ...m,
            [entry.id]: {
              type: 'error',
              text: result.error || t('serverManager.adminTools.uninstallFailed')
            }
          }))
        }
      } catch (err) {
        setMsg((m) => ({ ...m, [entry.id]: { type: 'error', text: String(err) } }))
      } finally {
        setBusy((b) => ({ ...b, [entry.id]: false }))
      }
    },
    [serverId, refreshInstalled, t]
  )

  return (
    <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] p-4 space-y-3 m-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
          <Package size={16} className="text-[var(--color-accent)]" />{' '}
          {t('serverManager.adminTools.title')}
        </h3>
        <button
          onClick={() => {
            loadCatalog()
            refreshInstalled()
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-active)] border border-[var(--color-border)] transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> {t('common.refresh')}
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{t('serverManager.adminTools.blurb')}</p>

      {loading ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 size={24} className="animate-spin text-[var(--color-accent)]" />
        </div>
      ) : error ? (
        <div className="text-center py-6">
          <AlertTriangle size={28} className="mx-auto mb-2 text-red-400" />
          <p className="text-red-300 text-sm">{error}</p>
          <button
            onClick={loadCatalog}
            className="mt-2 text-xs text-[var(--color-accent)] hover:underline"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : catalog.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">
          {t('serverManager.adminTools.noResults')}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {catalog.map((entry) => {
            const releases = releasesByPlugin[entry.id] || []
            const isInstalled = !!installed[entry.id]
            const installedVer = installed[entry.id]?.version
            const isBusy = !!busy[entry.id]
            const m = msg[entry.id]
            const { Icon: PluginIcon, className: iconClass } = adminPluginIcon(entry.id)
            return (
              <div
                key={entry.id}
                className="bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={`shrink-0 mt-0.5 w-8 h-8 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] flex items-center justify-center ${iconClass}`}>
                      <PluginIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-[var(--color-text-primary)] truncate">
                          {entry.name}
                        </h4>
                        {isInstalled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full border bg-green-500/15 text-green-300 border-green-500/30 flex items-center gap-1">
                            <Check size={10} /> v{installedVer}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        {t('serverManager.adminTools.by', { author: entry.author })}
                      </p>
                    </div>
                  </div>
                  <a
                    href={entry.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--color-accent)] flex items-center gap-1 shrink-0"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-snug">{entry.description}</p>

                {releases.length > 0 ? (
                  <select
                    value={selectedVersionByPlugin[entry.id] || ''}
                    onChange={(e) =>
                      setSelectedVersionByPlugin((s) => ({ ...s, [entry.id]: e.target.value }))
                    }
                    className="w-full px-2 py-1 text-xs bg-[var(--color-scrim-20)] rounded-lg border border-[var(--color-border)] text-[var(--color-text-primary)]"
                  >
                    {releases.map((r) => (
                      <option key={r.version} value={r.version}>
                        {r.version} {r.prerelease ? '(pre)' : ''} —{' '}
                        {(r.size / 1024).toFixed(0)} KB
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-[11px] text-[var(--text-muted)] italic">
                    {t('serverManager.adminTools.noReleases')}
                  </p>
                )}

                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => handleInstall(entry)}
                    disabled={isBusy || releases.length === 0}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-text-primary)] font-medium transition-colors disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    {isInstalled
                      ? t('serverManager.adminTools.reinstall')
                      : t('serverManager.adminTools.install')}
                  </button>
                  {isInstalled && (
                    <button
                      onClick={() => handleUninstall(entry)}
                      disabled={isBusy}
                      title={t('serverManager.adminTools.uninstall')}
                      className="px-2 py-1.5 text-xs rounded-lg bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-300 transition-colors disabled:opacity-50"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {m && (
                  <p
                    className={`text-[11px] ${m.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
                  >
                    {m.text}
                  </p>
                )}
                <PluginReadmeToggle pluginId={entry.id} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
