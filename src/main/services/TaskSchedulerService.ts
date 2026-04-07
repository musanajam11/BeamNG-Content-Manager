import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { app } from 'electron'
import { randomUUID } from 'crypto'
import type { ScheduledTask } from '../../shared/types'
import type { ServerManagerService } from './ServerManagerService'
import type { BackupSchedulerService } from './BackupSchedulerService'

export class TaskSchedulerService {
  private serversDir: string
  private timers = new Map<string, ReturnType<typeof setTimeout>>() // key: serverId:taskId
  private serverManager!: ServerManagerService
  private backupScheduler!: BackupSchedulerService

  constructor() {
    const base = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.serversDir = join(base, 'servers')
  }

  setDependencies(serverManager: ServerManagerService, backupScheduler: BackupSchedulerService): void {
    this.serverManager = serverManager
    this.backupScheduler = backupScheduler
  }

  // ── Lifecycle ──

  async init(): Promise<void> {
    try {
      const { readdir } = await import('fs/promises')
      const serverIds = await readdir(this.serversDir)
      for (const id of serverIds) {
        const tasks = await this.getTasks(id)
        for (const task of tasks) {
          if (task.enabled) this.scheduleTask(id, task)
        }
      }
    } catch { /* servers dir may not exist yet */ }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }

  // ── CRUD ──

  async getTasks(serverId: string): Promise<ScheduledTask[]> {
    const fp = join(this.serversDir, serverId, 'scheduled-tasks.json')
    try {
      const raw = await readFile(fp, 'utf-8')
      return JSON.parse(raw)
    } catch {
      return []
    }
  }

  async saveTask(serverId: string, task: ScheduledTask): Promise<ScheduledTask[]> {
    const tasks = await this.getTasks(serverId)
    const idx = tasks.findIndex((t) => t.id === task.id)

    if (task.enabled) {
      task.nextRun = this.computeNextRun(task)
    } else {
      task.nextRun = null
    }

    if (idx >= 0) {
      tasks[idx] = task
    } else {
      tasks.push(task)
    }

    await this.persistTasks(serverId, tasks)

    // Reschedule
    this.clearTimer(serverId, task.id)
    if (task.enabled) this.scheduleTask(serverId, task)

    return tasks
  }

  async createTask(serverId: string, partial: Omit<ScheduledTask, 'id' | 'lastRun' | 'nextRun' | 'lastResult'>): Promise<ScheduledTask[]> {
    const task: ScheduledTask = {
      ...partial,
      id: randomUUID(),
      lastRun: null,
      nextRun: null,
      lastResult: null
    }
    return this.saveTask(serverId, task)
  }

  async deleteTask(serverId: string, taskId: string): Promise<ScheduledTask[]> {
    this.clearTimer(serverId, taskId)
    const tasks = (await this.getTasks(serverId)).filter((t) => t.id !== taskId)
    await this.persistTasks(serverId, tasks)
    return tasks
  }

  async runTaskNow(serverId: string, taskId: string): Promise<ScheduledTask[]> {
    const tasks = await this.getTasks(serverId)
    const task = tasks.find((t) => t.id === taskId)
    if (!task) throw new Error('Task not found')
    await this.executeTask(serverId, task)
    // Refresh after execution (lastRun updated)
    return this.getTasks(serverId)
  }

  // ── Execution ──

  private async executeTask(serverId: string, task: ScheduledTask): Promise<void> {
    const tag = `[TaskScheduler] [${task.type}:${task.label}]`
    try {
      switch (task.type) {
        case 'backup':
          await this.backupScheduler.createBackup(serverId)
          task.lastResult = 'Backup created'
          break

        case 'restart':
          await this.serverManager.restartServer(serverId)
          task.lastResult = 'Server restarted'
          break

        case 'start':
          await this.serverManager.startServer(serverId)
          task.lastResult = 'Server started'
          break

        case 'stop':
          this.serverManager.stopServer(serverId)
          task.lastResult = 'Server stopped'
          break

        case 'command': {
          const cmd = String(task.config.command || '')
          if (!cmd) { task.lastResult = 'No command configured'; break }
          this.serverManager.sendCommand(serverId, cmd)
          task.lastResult = `Sent: ${cmd}`
          break
        }

        case 'message': {
          const msg = String(task.config.message || '')
          if (!msg) { task.lastResult = 'No message configured'; break }
          this.serverManager.sendCommand(serverId, `say ${msg}`)
          task.lastResult = `Announced: ${msg}`
          break
        }

        case 'update':
          await this.serverManager.downloadExe()
          task.lastResult = 'Server updated'
          break

        default:
          task.lastResult = `Unknown type: ${task.type}`
      }
      console.log(`${tag} Executed successfully`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      task.lastResult = `Error: ${msg}`
      console.error(`${tag} Failed:`, err)
    }

    task.lastRun = Date.now()

    // For 'once' tasks, disable after execution
    if (task.frequency === 'once') {
      task.enabled = false
      task.nextRun = null
    } else if (task.enabled) {
      task.nextRun = this.computeNextRun(task)
    }

    // Persist updated state
    const tasks = await this.getTasks(serverId)
    const idx = tasks.findIndex((t) => t.id === task.id)
    if (idx >= 0) tasks[idx] = task
    await this.persistTasks(serverId, tasks)

    // Reschedule repeating tasks
    if (task.enabled && task.frequency !== 'once') {
      this.scheduleTask(serverId, task)
    }
  }

  // ── Scheduling ──

  private computeNextRun(task: ScheduledTask): number {
    const now = new Date()
    const [hours, minutes] = task.timeOfDay.split(':').map(Number)

    switch (task.frequency) {
      case 'once': {
        const next = new Date(now)
        next.setHours(hours, minutes, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1) // next occurrence
        return next.getTime()
      }
      case 'hourly': {
        const next = new Date(now)
        next.setMinutes(minutes, 0, 0)
        if (next <= now) next.setHours(next.getHours() + 1)
        return next.getTime()
      }
      case 'daily': {
        const next = new Date(now)
        next.setHours(hours, minutes, 0, 0)
        if (next <= now) next.setDate(next.getDate() + 1)
        return next.getTime()
      }
      case 'weekly': {
        const next = new Date(now)
        next.setHours(hours, minutes, 0, 0)
        const dayDiff = (task.dayOfWeek - next.getDay() + 7) % 7
        if (dayDiff === 0 && next <= now) {
          next.setDate(next.getDate() + 7)
        } else {
          next.setDate(next.getDate() + dayDiff)
        }
        return next.getTime()
      }
      default:
        return Date.now() + 86400000
    }
  }

  private scheduleTask(serverId: string, task: ScheduledTask): void {
    const key = `${serverId}:${task.id}`
    this.clearTimer(serverId, task.id)
    if (!task.enabled || !task.nextRun) return

    const delay = Math.max(0, task.nextRun - Date.now())
    // Cap to max setTimeout (~24.8 days)
    const safeDelay = Math.min(delay, 2_147_483_647)

    const timer = setTimeout(async () => {
      await this.executeTask(serverId, task)
    }, safeDelay)

    this.timers.set(key, timer)
  }

  private clearTimer(serverId: string, taskId: string): void {
    const key = `${serverId}:${taskId}`
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
  }

  // ── Persistence ──

  private async persistTasks(serverId: string, tasks: ScheduledTask[]): Promise<void> {
    const dir = join(this.serversDir, serverId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'scheduled-tasks.json'), JSON.stringify(tasks, null, 2))
  }
}
