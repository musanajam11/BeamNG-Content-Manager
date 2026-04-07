import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerExeStatus } from '../../../shared/types'
import { useHostedServerStore } from '../stores/useHostedServerStore'
import { ConfirmDialog } from '../components/server-manager/ConfirmDialog'
import { ServerManagerToolbar } from '../components/server-manager/ServerManagerToolbar'
import { InstancesGrid } from '../components/server-manager/InstancesGrid'
import { SidebarNav } from '../components/server-manager/SidebarNav'
import { StatusDashboard } from '../components/server-manager/StatusDashboard'
import { ConfigEditor } from '../components/server-manager/ConfigEditor'
import { ConsolePanel } from '../components/server-manager/ConsolePanel'
import { FilesPanel } from '../components/server-manager/FilesPanel'
import { ModsPanel } from '../components/server-manager/ModsPanel'
import HeatMapPanel from '../components/server-manager/HeatMapPanel'
import { SchedulePanel } from '../components/server-manager/SchedulePanel'
import { AnalyticsPanel } from '../components/server-manager/AnalyticsPanel'
import { ToastContainer } from '../components/server-manager/ToastContainer'
import { CumulativeMetrics } from '../components/server-manager/CumulativeMetrics'

export function ServerManagerPage(): React.JSX.Element {
  const store = useHostedServerStore()
  const { t } = useTranslation()

  useEffect(() => {
    store.refresh()
  }, [])

  useEffect(() => {
    const cleanupConsole = window.api.onHostedServerConsole(
      (data: { serverId: string; lines: string[] }) => {
        store.appendConsoleLines(data.serverId, data.lines)
      }
    )
    const cleanupStatus = window.api.onHostedServerStatusChange((status) => {
      store.updateServerStatus(status)
    })
    return () => { cleanupConsole(); cleanupStatus() }
  }, [])

  useEffect(() => {
    const cleanup = window.api.onHostedServerExeStatus((s: ServerExeStatus) => {
      useHostedServerStore.setState({ exeStatus: s })
    })
    return cleanup
  }, [])

  const { selected } = store

  return (
    <div className="flex flex-col h-full gap-4">
      <ToastContainer />
      {/* Confirm dialog */}
      <ConfirmDialog
        open={store.confirmDialog.open}
        title={store.confirmDialog.title}
        message={store.confirmDialog.message}
        variant={store.confirmDialog.variant}
        confirmLabel="Delete"
        onConfirm={store.confirmDialog.onConfirm}
        onCancel={store.closeConfirmDialog}
      />

      {/* Header */}
      <ServerManagerToolbar
        exeStatus={store.exeStatus}
        viewMode={store.viewMode}
        serverName={selected?.config.name}
        hasServers={store.servers.length > 0}
        onCreate={store.createServer}
        onDownloadExe={store.downloadExe}
        onBrowseExe={store.browseExe}
        onInstallExe={store.installExe}
        onStartAll={store.startAll}
        onStopAll={store.stopAll}
        onBackToGrid={store.backToGrid}
      />

      {/* Cumulative metrics strip (grid view only) */}
      {store.viewMode === 'grid' && store.servers.length > 0 && (
        <CumulativeMetrics servers={store.servers} />
      )}

      {/* Body: grid or detail view */}
      {store.viewMode === 'grid' ? (
        <InstancesGrid
          servers={store.servers}
          onOpen={store.openDetail}
          onStart={store.startServer}
          onStop={store.stopServer}
          onDelete={store.confirmDeleteServer}
          onDuplicate={store.duplicateServer}
        />
      ) : selected ? (
        <div className="flex-1 flex min-h-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
          {/* Vertical sidebar nav */}
          <SidebarNav
            activeTab={store.tab}
            serverName={selected.config.name}
            serverState={selected.status.state}
            onTabChange={(tab) => {
              store.setTab(tab)
              if (tab === 'console') store.loadConsole(selected.config.id)
              if (tab === 'files') store.loadFiles(selected.config.id, store.filePath)
              if (tab === 'mods') store.loadMods()
            }}
          />

          {/* Tab content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {store.tab === 'status' ? (
              <StatusDashboard server={selected} exeStatus={store.exeStatus} onStart={() => store.startServer(selected.config.id)} onStop={() => store.stopServer(selected.config.id)} onRestart={() => store.restartServer(selected.config.id)} />
            ) : store.tab === 'config' ? (
              <ConfigEditor draft={store.draft} setDraft={store.setDraft} onSave={store.saveConfig} onDelete={() => store.confirmDeleteServer(selected.config.id, selected.config.name)} saving={store.saving} serverId={selected.config.id} />
            ) : store.tab === 'console' ? (
              <ConsolePanel lines={store.consoleLines} cmdInput={store.cmdInput} setCmdInput={store.setCmdInput} onSend={store.sendCommand} onClear={store.clearConsole} />
            ) : store.tab === 'files' ? (
              <FilesPanel serverId={selected.config.id} files={store.files} filePath={store.filePath} onNavigate={(sub) => store.loadFiles(selected.config.id, sub)} onRefresh={() => store.loadFiles(selected.config.id, store.filePath)} />
            ) : store.tab === 'heatmap' ? (
              <HeatMapPanel server={selected} />
            ) : store.tab === 'schedule' ? (
              <SchedulePanel serverId={selected.config.id} />
            ) : store.tab === 'analytics' ? (
              <AnalyticsPanel serverId={selected.config.id} />
            ) : (
              <ModsPanel serverId={selected.config.id} mods={store.mods} onRefresh={() => { store.loadMods(); store.loadFiles(selected.config.id, store.filePath) }} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)] text-sm">
          {t('serverManager.selectOrCreate')}
        </div>
      )}
    </div>
  )
}

