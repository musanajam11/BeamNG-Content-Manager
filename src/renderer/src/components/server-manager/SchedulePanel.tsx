import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, Download, Trash2, RotateCcw, Play, Loader2, Plus, RefreshCw, Terminal, MessageSquare, ArrowDownToLine, Square, Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { BackupEntry, ScheduledTask, ScheduledTaskType, TaskFrequency } from '../../../../shared/types'

interface SchedulePanelProps {
  serverId: string
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string

const TASK_TYPE_ICONS: Record<ScheduledTaskType, { icon: typeof Play; color: string }> = {
  backup: { icon: Download, color: 'text-blue-400' },
  restart: { icon: RefreshCw, color: 'text-[var(--color-accent)]' },
  start: { icon: Play, color: 'text-green-400' },
  stop: { icon: Square, color: 'text-red-400' },
  command: { icon: Terminal, color: 'text-purple-400' },
  message: { icon: MessageSquare, color: 'text-cyan-400' },
  update: { icon: ArrowDownToLine, color: 'text-yellow-400' },
}

const TASK_TYPE_KEYS: ScheduledTaskType[] = ['backup', 'restart', 'start', 'stop', 'command', 'message', 'update']
const FREQ_KEYS: TaskFrequency[] = ['once', 'hourly', 'daily', 'weekly']

const TASK_TYPE_I18N: Record<ScheduledTaskType, string> = {
  backup: 'serverManager.taskBackup',
  restart: 'serverManager.taskRestart',
  start: 'serverManager.taskStart',
  stop: 'serverManager.taskStop',
  command: 'serverManager.taskCommand',
  message: 'serverManager.taskMessage',
  update: 'serverManager.taskUpdate',
}

const FREQ_I18N: Record<TaskFrequency, string> = {
  once: 'serverManager.freqOnce',
  hourly: 'serverManager.freqHourly',
  daily: 'serverManager.freqDaily',
  weekly: 'serverManager.freqWeekly',
}

const DAY_KEYS = [
  'serverManager.sunday', 'serverManager.monday', 'serverManager.tuesday',
  'serverManager.wednesday', 'serverManager.thursday', 'serverManager.friday', 'serverManager.saturday'
]

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

function timeAgo(ms: number, t: TFunc): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('time.justNow')
  if (mins < 60) return t('time.minutesAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return t('time.daysAgo', { n: days })
}

export function SchedulePanel({ serverId }: SchedulePanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [backups, setBackups] = useState<BackupEntry[]>([])
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [showNewTask, setShowNewTask] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTask | null>(null)
  const [runningTask, setRunningTask] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const [b, t] = await Promise.all([
      window.api.hostedServerListBackups(serverId),
      window.api.hostedServerGetTasks(serverId)
    ])
    setBackups(b)
    setTasks(t)
    setLoading(false)
  }, [serverId])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleCreateBackup = async (): Promise<void> => {
    setCreating(true)
    try {
      await window.api.hostedServerCreateBackup(serverId)
      const b = await window.api.hostedServerListBackups(serverId)
      setBackups(b)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (filename: string): Promise<void> => {
    await window.api.hostedServerDeleteBackup(serverId, filename)
    setBackups((prev) => prev.filter((b) => b.filename !== filename))
  }

  const handleRestore = async (filename: string): Promise<void> => {
    setRestoring(filename)
    try {
      await window.api.hostedServerRestoreBackup(serverId, filename)
    } finally {
      setRestoring(null)
    }
  }

  const handleCreateTask = async (task: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'lastResult'>): Promise<void> => {
    const updated = await window.api.hostedServerCreateTask(serverId, task)
    setTasks(updated)
    setShowNewTask(false)
  }

  const handleSaveTask = async (task: ScheduledTask): Promise<void> => {
    const updated = await window.api.hostedServerSaveTask(serverId, task)
    setTasks(updated)
    setEditingTask(null)
  }

  const handleDeleteTask = async (taskId: string): Promise<void> => {
    const updated = await window.api.hostedServerDeleteTask(serverId, taskId)
    setTasks(updated)
  }

  const handleRunTask = async (taskId: string): Promise<void> => {
    setRunningTask(taskId)
    try {
      const updated = await window.api.hostedServerRunTaskNow(serverId, taskId)
      setTasks(updated)
    } finally {
      setRunningTask(null)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-text-muted)]">
        <Loader2 size={20} className="animate-spin mr-2" />
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">{t('serverManager.scheduleAndTasks')}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowNewTask(true); setEditingTask(null) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/30 transition-colors"
          >
            <Plus size={14} /> {t('serverManager.newTask')}
          </button>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {creating ? t('serverManager.creatingBackup') : t('serverManager.backupNow')}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* New Task / Edit Task Form */}
        {(showNewTask || editingTask) && (
          <TaskForm
            task={editingTask}
            onSave={(t) => editingTask ? handleSaveTask({ ...editingTask, ...t }) : handleCreateTask(t)}
            onCancel={() => { setShowNewTask(false); setEditingTask(null) }}
          />
        )}

        {/* Scheduled Tasks List */}
        {tasks.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={14} className="text-[var(--color-text-muted)]" />
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {t('serverManager.scheduledTasks', { count: tasks.length })}
              </span>
            </div>
            <div className="space-y-1">
              {tasks.map((task) => {
                const typeInfo = TASK_TYPE_ICONS[task.type]
                const Icon = typeInfo?.icon ?? Calendar
                return (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors">
                    <Icon size={14} className={typeInfo?.color ?? 'text-[var(--color-text-muted)]'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[var(--color-text-primary)] truncate">{task.label}</span>
                        {!task.enabled && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded">{t('serverManager.paused')}</span>}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                        {task.frequency}{task.frequency !== 'hourly' && task.frequency !== 'once' ? ` at ${task.timeOfDay}` : ''}
                        {task.lastRun ? ` · last: ${timeAgo(task.lastRun, t)}` : ''}
                        {task.lastResult ? ` · ${task.lastResult}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSaveTask({ ...task, enabled: !task.enabled })}
                      title={task.enabled ? t('serverManager.disable') : t('serverManager.enable')}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${task.enabled ? 'bg-[var(--color-accent)]' : 'bg-zinc-600'}`}
                    >
                      <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${task.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                    <button onClick={() => handleRunTask(task.id)} disabled={runningTask === task.id} title={t('serverManager.runNow')} className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
                      {runningTask === task.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                    <button onClick={() => { setEditingTask(task); setShowNewTask(false) }} title={t('serverManager.edit')} className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-blue-400 hover:bg-blue-400/10 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDeleteTask(task.id)} title={t('serverManager.delete')} className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Backup List */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Download size={14} className="text-[var(--color-text-muted)]" />
            <span className="text-sm font-medium text-[var(--color-text-primary)]">
              {t('serverManager.backups', { count: backups.length })}
            </span>
          </div>

          {backups.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
              {t('serverManager.noBackupsYet')}
            </div>
          ) : (
            <div className="space-y-1">
              {backups.map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[var(--color-text-primary)] truncate">{b.filename}</div>
                    <div className="text-[11px] text-[var(--color-text-muted)]">
                      {formatDate(b.createdAt)} &middot; {formatSize(b.size)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(b.filename)}
                    disabled={restoring === b.filename}
                    title={t('serverManager.restoreBackup')}
                    className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
                  >
                    {restoring === b.filename ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(b.filename)}
                    title={t('serverManager.deleteBackup')}
                    className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── TaskForm ─────────────────────────────────────────────── */

interface TaskFormProps {
  task: ScheduledTask | null
  onSave: (t: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'lastResult'>) => void
  onCancel: () => void
}

function TaskForm({ task, onSave, onCancel }: TaskFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [type, setType] = useState<ScheduledTaskType>(task?.type ?? 'backup')
  const [label, setLabel] = useState(task?.label ?? '')
  const [frequency, setFrequency] = useState<TaskFrequency>(task?.frequency ?? 'daily')
  const [timeOfDay, setTimeOfDay] = useState(task?.timeOfDay ?? '03:00')
  const [dayOfWeek, setDayOfWeek] = useState(task?.dayOfWeek ?? 0)
  const [config, setConfig] = useState<Record<string, string | number | boolean>>(task?.config ?? {})

  const autoLabel = t(TASK_TYPE_I18N[type])
  const effectiveLabel = label || autoLabel

  const submit = (): void => {
    onSave({ label: effectiveLabel, type, enabled: task?.enabled ?? true, frequency, timeOfDay, dayOfWeek, config })
  }

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-surface)] p-4 space-y-4">
      <span className="text-sm font-medium text-[var(--color-text-primary)]">{task ? t('serverManager.editTask') : t('serverManager.newScheduledTask')}</span>

      {/* Task Type */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.taskType')}</label>
        <div className="grid grid-cols-4 gap-1.5">
          {TASK_TYPE_KEYS.map((value) => {
            const info = TASK_TYPE_ICONS[value]
            const Icon = info.icon
            return (
              <button
                key={value}
                onClick={() => { setType(value); if (!label) setLabel('') }}
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                  type === value
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <Icon size={12} className={type === value ? info.color : ''} />
                {t(TASK_TYPE_I18N[value])}
              </button>
            )
          })}
        </div>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.taskLabel')}</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={autoLabel}
          className="w-full px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
        />
      </div>

      {/* Config fields based on type */}
      {type === 'command' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.command')}</label>
          <input
            value={(config.command as string) ?? ''}
            onChange={(e) => setConfig({ ...config, command: e.target.value })}
            placeholder={t('serverManager.commandPlaceholder')}
            className="w-full px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md font-mono"
          />
        </div>
      )}
      {type === 'message' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.message')}</label>
          <input
            value={(config.message as string) ?? ''}
            onChange={(e) => setConfig({ ...config, message: e.target.value })}
            placeholder={t('serverManager.messagePlaceholder')}
            className="w-full px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
          />
        </div>
      )}

      {/* Frequency */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.frequency')}</label>
        <div className="flex gap-2">
          {FREQ_KEYS.map((value) => (
            <button
              key={value}
              onClick={() => setFrequency(value)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                frequency === value
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {t(FREQ_I18N[value])}
            </button>
          ))}
        </div>
      </div>

      {/* Time (for daily/weekly/once) */}
      {frequency !== 'hourly' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
            <Clock size={12} /> {t('serverManager.time')}
          </label>
          <input
            type="time"
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            className="px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
          />
        </div>
      )}

      {/* Day (for weekly) */}
      {frequency === 'weekly' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">{t('serverManager.dayOfWeek')}</label>
          <select
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
            className="px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
          >
            {DAY_KEYS.map((key, i) => (
              <option key={key} value={i}>{t(key)}</option>
            ))}
          </select>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2 border-t border-[var(--color-border)]">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-[var(--color-text-muted)] border border-[var(--color-border)] rounded-md hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={submit}
          className="px-3 py-1.5 text-xs bg-[var(--color-accent)] text-white rounded-md hover:bg-[var(--color-accent)]/80 transition-colors"
        >
          {task ? t('common.save') : t('serverManager.create')}
        </button>
      </div>
    </div>
  )
}
