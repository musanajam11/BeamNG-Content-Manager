import { useState, useEffect, useCallback } from 'react'
import { Calendar, Clock, Download, Trash2, RotateCcw, Play, Loader2, Plus, RefreshCw, Terminal, MessageSquare, ArrowDownToLine, Square, Pencil } from 'lucide-react'
import type { BackupEntry, ScheduledTask, ScheduledTaskType, TaskFrequency } from '../../../../shared/types'

interface SchedulePanelProps {
  serverId: string
}

const TASK_TYPES: { value: ScheduledTaskType; label: string; icon: typeof Play; color: string }[] = [
  { value: 'backup', label: 'Backup', icon: Download, color: 'text-blue-400' },
  { value: 'restart', label: 'Restart Server', icon: RefreshCw, color: 'text-[var(--color-accent)]' },
  { value: 'start', label: 'Start Server', icon: Play, color: 'text-green-400' },
  { value: 'stop', label: 'Stop Server', icon: Square, color: 'text-red-400' },
  { value: 'command', label: 'Console Command', icon: Terminal, color: 'text-purple-400' },
  { value: 'message', label: 'Chat Message', icon: MessageSquare, color: 'text-cyan-400' },
  { value: 'update', label: 'Update Server', icon: ArrowDownToLine, color: 'text-yellow-400' },
]

const FREQ_OPTIONS: { value: TaskFrequency; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString()
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function SchedulePanel({ serverId }: SchedulePanelProps): React.JSX.Element {
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
        Loading...
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">Schedule &amp; Tasks</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowNewTask(true); setEditingTask(null) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30 hover:bg-[var(--color-accent)]/30 transition-colors"
          >
            <Plus size={14} /> New Task
          </button>
          <button
            onClick={handleCreateBackup}
            disabled={creating}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {creating ? 'Creating...' : 'Backup Now'}
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
                Scheduled Tasks ({tasks.length})
              </span>
            </div>
            <div className="space-y-1">
              {tasks.map((task) => {
                const typeInfo = TASK_TYPES.find((t) => t.value === task.type)
                const Icon = typeInfo?.icon ?? Calendar
                return (
                  <div key={task.id} className="flex items-center gap-3 px-4 py-2.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors">
                    <Icon size={14} className={typeInfo?.color ?? 'text-[var(--color-text-muted)]'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[var(--color-text-primary)] truncate">{task.label}</span>
                        {!task.enabled && <span className="text-[10px] px-1.5 py-0.5 bg-zinc-700 text-zinc-400 rounded">paused</span>}
                      </div>
                      <div className="text-[11px] text-[var(--color-text-muted)]">
                        {task.frequency}{task.frequency !== 'hourly' && task.frequency !== 'once' ? ` at ${task.timeOfDay}` : ''}
                        {task.lastRun ? ` · last: ${timeAgo(task.lastRun)}` : ''}
                        {task.lastResult ? ` · ${task.lastResult}` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleSaveTask({ ...task, enabled: !task.enabled })}
                      title={task.enabled ? 'Disable' : 'Enable'}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${task.enabled ? 'bg-[var(--color-accent)]' : 'bg-zinc-600'}`}
                    >
                      <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${task.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                    </button>
                    <button onClick={() => handleRunTask(task.id)} disabled={runningTask === task.id} title="Run now" className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-green-400 hover:bg-green-400/10 transition-colors disabled:opacity-50">
                      {runningTask === task.id ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                    </button>
                    <button onClick={() => { setEditingTask(task); setShowNewTask(false) }} title="Edit" className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-blue-400 hover:bg-blue-400/10 transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDeleteTask(task.id)} title="Delete" className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-red-400 hover:bg-red-400/10 transition-colors">
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
              Backups ({backups.length})
            </span>
          </div>

          {backups.length === 0 ? (
            <div className="text-sm text-[var(--color-text-muted)] text-center py-6 border border-dashed border-[var(--color-border)] rounded-lg">
              No backups yet. Click &quot;Backup Now&quot; to create one.
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
                    title="Restore this backup"
                    className="p-1.5 rounded text-[var(--color-text-muted)] hover:text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
                  >
                    {restoring === b.filename ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(b.filename)}
                    title="Delete this backup"
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
  const [type, setType] = useState<ScheduledTaskType>(task?.type ?? 'backup')
  const [label, setLabel] = useState(task?.label ?? '')
  const [frequency, setFrequency] = useState<TaskFrequency>(task?.frequency ?? 'daily')
  const [timeOfDay, setTimeOfDay] = useState(task?.timeOfDay ?? '03:00')
  const [dayOfWeek, setDayOfWeek] = useState(task?.dayOfWeek ?? 0)
  const [config, setConfig] = useState<Record<string, string | number | boolean>>(task?.config ?? {})

  const autoLabel = TASK_TYPES.find((t) => t.value === type)?.label ?? type
  const effectiveLabel = label || autoLabel

  const submit = (): void => {
    onSave({ label: effectiveLabel, type, enabled: task?.enabled ?? true, frequency, timeOfDay, dayOfWeek, config })
  }

  return (
    <div className="rounded-lg border border-[var(--color-accent)]/30 bg-[var(--color-surface)] p-4 space-y-4">
      <span className="text-sm font-medium text-[var(--color-text-primary)]">{task ? 'Edit Task' : 'New Scheduled Task'}</span>

      {/* Task Type */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">Task Type</label>
        <div className="grid grid-cols-4 gap-1.5">
          {TASK_TYPES.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.value}
                onClick={() => { setType(t.value); if (!label) setLabel('') }}
                className={`flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-md border transition-colors ${
                  type === t.value
                    ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                    : 'text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <Icon size={12} className={type === t.value ? t.color : ''} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Label */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">Label</label>
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
          <label className="text-xs text-[var(--color-text-muted)]">Command</label>
          <input
            value={(config.command as string) ?? ''}
            onChange={(e) => setConfig({ ...config, command: e.target.value })}
            placeholder="e.g. kick all"
            className="w-full px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md font-mono"
          />
        </div>
      )}
      {type === 'message' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)]">Message</label>
          <input
            value={(config.message as string) ?? ''}
            onChange={(e) => setConfig({ ...config, message: e.target.value })}
            placeholder="Server restarting in 5 minutes..."
            className="w-full px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
          />
        </div>
      )}

      {/* Frequency */}
      <div className="space-y-1.5">
        <label className="text-xs text-[var(--color-text-muted)]">Frequency</label>
        <div className="flex gap-2">
          {FREQ_OPTIONS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFrequency(f.value)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                frequency === f.value
                  ? 'bg-[var(--color-accent)]/20 text-[var(--color-accent)] border-[var(--color-accent)]/30'
                  : 'text-[var(--color-text-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Time (for daily/weekly/once) */}
      {frequency !== 'hourly' && (
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
            <Clock size={12} /> Time
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
          <label className="text-xs text-[var(--color-text-muted)]">Day of Week</label>
          <select
            value={dayOfWeek}
            onChange={(e) => setDayOfWeek(Number(e.target.value))}
            className="px-2 py-1 text-sm bg-[var(--color-bg)] text-[var(--color-text-primary)] border border-[var(--color-border)] rounded-md"
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i}>{d}</option>
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
          Cancel
        </button>
        <button
          onClick={submit}
          className="px-3 py-1.5 text-xs bg-[var(--color-accent)] text-white rounded-md hover:bg-[var(--color-accent)]/80 transition-colors"
        >
          {task ? 'Save' : 'Create'}
        </button>
      </div>
    </div>
  )
}
