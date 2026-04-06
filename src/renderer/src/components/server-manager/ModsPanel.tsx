import { Package, Server, Trash2 } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useConfirmDialog } from '../../hooks/useConfirmDialog'

interface ModsPanelProps {
  serverId: string
  mods: { key: string; name: string; active: boolean; filePath: string }[]
  onRefresh: () => void
}

export function ModsPanel({ serverId, mods, onRefresh }: ModsPanelProps): React.JSX.Element {
  const [registryMeta, setRegistryMeta] = useState<Record<string, { multiplayer_scope?: string }>>({})
  const [copying, setCopying] = useState<string | null>(null)
  const [undeploying, setUndeploying] = useState<string | null>(null)
  const [deployedNames, setDeployedNames] = useState<Set<string>>(new Set())
  const { dialog: confirmDialogEl, confirm } = useConfirmDialog()

  const fetchDeployed = async (): Promise<void> => {
    try {
      const names = await window.api.hostedServerDeployedMods(serverId)
      setDeployedNames(new Set(names))
    } catch { /* not critical */ }
  }

  useEffect(() => { fetchDeployed() }, [serverId])

  useEffect(() => {
    window.api.registryGetInstalled().then((installed) => {
      const meta: Record<string, { multiplayer_scope?: string }> = {}
      for (const [, entry] of Object.entries(installed)) {
        const scope = (entry as { metadata?: { multiplayer_scope?: string } }).metadata?.multiplayer_scope
        const files = (entry as { installed_files?: string[] }).installed_files ?? []
        for (const f of files) {
          const normName = f.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
          meta[normName] = { multiplayer_scope: scope }
        }
      }
      setRegistryMeta(meta)
    }).catch(() => { /* not critical */ })
  }, [mods])

  const getScope = (filePath: string): string | undefined => {
    const fileName = filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
    return registryMeta[fileName]?.multiplayer_scope
  }

  const handleCopy = async (modFilePath: string): Promise<void> => {
    setCopying(modFilePath)
    try {
      await window.api.hostedServerCopyMod(serverId, modFilePath)
      await fetchDeployed()
      onRefresh()
    } finally {
      setCopying(null)
    }
  }

  const handleUndeploy = async (fileName: string): Promise<void> => {
    const ok = await confirm({
      title: 'Undeploy Mod',
      message: `Remove "${fileName}" from this server? This will delete the mod's client and server files from the server.`,
      confirmLabel: 'Undeploy',
      variant: 'danger'
    })
    if (!ok) return
    setUndeploying(fileName)
    try {
      await window.api.hostedServerUndeployMod(serverId, fileName)
      await fetchDeployed()
      onRefresh()
    } finally {
      setUndeploying(null)
    }
  }

  return (
    <>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 py-2 border-b border-[var(--color-border)] text-xs text-[var(--color-text-muted)]">
          Deploy installed mods to this server. Mods with server components will install both client and server files.
        </div>
      <div className="flex-1 overflow-y-auto">
        {mods.length === 0 ? (
          <div className="text-[var(--color-text-muted)] text-center py-8 text-sm">
            No mods installed. Install mods from the Mods page first.
          </div>
        ) : (
          mods.map((m) => {
            const scope = getScope(m.filePath)
            const hasServerComponent = scope === 'both' || scope === 'server'
            const isCopying = copying === m.filePath
            const fileName = m.filePath.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? ''
            const isDeployed = deployedNames.has(fileName)
            return (
              <div
                key={m.key}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]"
              >
                <Package
                  size={14}
                  className={isDeployed ? 'text-green-400' : 'text-[var(--color-text-muted)]'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--color-text-primary)] truncate">{m.name}</span>
                    {hasServerComponent && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 text-purple-300 bg-purple-400/10 border border-purple-400/20 shrink-0">
                        <Server size={10} />Client + Server
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[var(--color-text-muted)] truncate">{m.key}</div>
                </div>
                <span
                  className={`text-[11px] px-1.5 py-0.5 ${
                    isDeployed
                      ? 'text-green-400 bg-green-400/10'
                      : 'text-[var(--color-text-muted)] bg-[var(--color-surface)]'
                  }`}
                >
                  {isDeployed ? 'Deployed' : 'Not deployed'}
                </span>
                <button
                  onClick={() => handleCopy(m.filePath)}
                  disabled={isCopying}
                  className="text-xs px-2.5 py-1 bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/30 transition-colors disabled:opacity-50"
                >
                  {isCopying ? 'Deploying…' : isDeployed ? 'Redeploy' : hasServerComponent ? 'Deploy to Server' : 'Copy to Server'}
                </button>
                {isDeployed && (
                  <button
                    onClick={() => handleUndeploy(fileName)}
                    disabled={undeploying === fileName}
                    className="text-xs px-2 py-1 text-red-400 bg-red-400/10 border border-red-400/20 hover:bg-red-400/20 transition-colors disabled:opacity-50"
                    title="Remove mod from this server"
                  >
                    {undeploying === fileName ? (
                      'Removing…'
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
      </div>
      {confirmDialogEl}
    </>
  )
}
