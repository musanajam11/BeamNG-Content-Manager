import { readFile, writeFile, mkdir, readdir, stat, cp } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import { app } from 'electron'
import type { BackupSchedule, BackupEntry } from '../../shared/types'

const DEFAULT_SCHEDULE: BackupSchedule = {
  enabled: false,
  frequency: 'daily',
  timeOfDay: '03:00',
  dayOfWeek: 0,
  maxBackups: 10,
  lastBackup: null,
  nextBackup: null
}

export class BackupSchedulerService {
  private serversDir: string
  private backupsDir: string
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor() {
    const base = join(app.getPath('appData'), 'BeamMP-ContentManager')
    this.serversDir = join(base, 'servers')
    this.backupsDir = join(base, 'backups')
  }

  async init(): Promise<void> {
    await mkdir(this.backupsDir, { recursive: true })
    // Resume schedules for all servers that have backups enabled
    try {
      const serverIds = await readdir(this.serversDir)
      for (const id of serverIds) {
        const schedule = await this.getSchedule(id)
        if (schedule.enabled) {
          this.scheduleNext(id, schedule)
        }
      }
    } catch { /* servers dir may not exist yet */ }
  }

  // ── Schedule CRUD ──

  async getSchedule(serverId: string): Promise<BackupSchedule> {
    const fp = join(this.serversDir, serverId, 'backup-schedule.json')
    try {
      const raw = await readFile(fp, 'utf-8')
      return { ...DEFAULT_SCHEDULE, ...JSON.parse(raw) }
    } catch {
      return { ...DEFAULT_SCHEDULE }
    }
  }

  async saveSchedule(serverId: string, schedule: Partial<BackupSchedule>): Promise<BackupSchedule> {
    const current = await this.getSchedule(serverId)
    const merged: BackupSchedule = { ...current, ...schedule }

    // Compute next backup time
    if (merged.enabled) {
      merged.nextBackup = this.computeNextBackup(merged)
      this.scheduleNext(serverId, merged)
    } else {
      merged.nextBackup = null
      this.clearTimer(serverId)
    }

    const dir = join(this.serversDir, serverId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'backup-schedule.json'), JSON.stringify(merged, null, 2))
    return merged
  }

  // ── Backup Operations ──

  async createBackup(serverId: string): Promise<BackupEntry> {
    const serverDir = join(this.serversDir, serverId)
    if (!existsSync(serverDir)) throw new Error('Server directory not found')

    const backupDir = join(this.backupsDir, serverId)
    await mkdir(backupDir, { recursive: true })

    const timestamp = Date.now()
    const dateStr = new Date(timestamp).toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename = `backup_${dateStr}`
    const outPath = join(backupDir, filename)

    // Recursive copy of the server directory
    await cp(serverDir, outPath, {
      recursive: true,
      filter: (src: string) => !src.includes('backup-schedule.json')
    })

    // Calculate total size
    const size = await this.dirSize(outPath)

    // Update schedule with last backup time
    const schedule = await this.getSchedule(serverId)
    schedule.lastBackup = timestamp
    if (schedule.enabled) {
      schedule.nextBackup = this.computeNextBackup(schedule)
      this.scheduleNext(serverId, schedule)
    }
    await writeFile(
      join(serverDir, 'backup-schedule.json'),
      JSON.stringify(schedule, null, 2)
    )

    // Enforce retention
    await this.enforceRetention(serverId, schedule.maxBackups)

    return { filename, size, createdAt: timestamp }
  }

  private async dirSize(dir: string): Promise<number> {
    let total = 0
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fp = join(dir, entry.name)
        if (entry.isDirectory()) {
          total += await this.dirSize(fp)
        } else {
          const info = await stat(fp)
          total += info.size
        }
      }
    } catch { /* ignore */ }
    return total
  }

  async listBackups(serverId: string): Promise<BackupEntry[]> {
    const backupDir = join(this.backupsDir, serverId)
    try {
      const files = await readdir(backupDir, { withFileTypes: true })
      const entries: BackupEntry[] = []
      for (const f of files) {
        if (!f.isDirectory() || !f.name.startsWith('backup_')) continue
        const info = await stat(join(backupDir, f.name))
        const size = await this.dirSize(join(backupDir, f.name))
        entries.push({
          filename: f.name,
          size,
          createdAt: info.birthtimeMs
        })
      }
      entries.sort((a, b) => b.createdAt - a.createdAt)
      return entries
    } catch {
      return []
    }
  }

  async deleteBackup(serverId: string, filename: string): Promise<void> {
    // Sanitize filename to prevent path traversal
    const safe = basename(filename)
    if (!safe.startsWith('backup_')) throw new Error('Invalid backup name')
    const fp = join(this.backupsDir, serverId, safe)
    const { rm } = await import('fs/promises')
    await rm(fp, { recursive: true })
  }

  async restoreBackup(serverId: string, filename: string): Promise<void> {
    const safe = basename(filename)
    if (!safe.startsWith('backup_')) throw new Error('Invalid backup name')
    const backupPath = join(this.backupsDir, serverId, safe)
    const serverDir = join(this.serversDir, serverId)

    if (!existsSync(backupPath)) throw new Error('Backup not found')

    // Copy backup contents over the server directory
    await cp(backupPath, serverDir, {
      recursive: true,
      force: true
    })
  }

  // ── Scheduling Logic ──

  private computeNextBackup(schedule: BackupSchedule): number {
    const now = new Date()
    const [hours, minutes] = schedule.timeOfDay.split(':').map(Number)

    switch (schedule.frequency) {
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
        const dayDiff = (schedule.dayOfWeek - next.getDay() + 7) % 7
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

  private scheduleNext(serverId: string, schedule: BackupSchedule): void {
    this.clearTimer(serverId)
    if (!schedule.enabled || !schedule.nextBackup) return

    const delay = Math.max(0, schedule.nextBackup - Date.now())
    // Cap to max setTimeout (~24.8 days). For longer, we'll re-schedule on next app launch.
    const safeDelay = Math.min(delay, 2_147_483_647)

    const timer = setTimeout(async () => {
      try {
        await this.createBackup(serverId)
        console.log(`[BackupScheduler] Auto-backup completed for server ${serverId}`)
      } catch (err) {
        console.error(`[BackupScheduler] Auto-backup failed for server ${serverId}:`, err)
      }
    }, safeDelay)

    this.timers.set(serverId, timer)
  }

  private clearTimer(serverId: string): void {
    const timer = this.timers.get(serverId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(serverId)
    }
  }

  private async enforceRetention(serverId: string, maxBackups: number): Promise<void> {
    if (maxBackups <= 0) return
    const backups = await this.listBackups(serverId)
    // backups are sorted newest-first
    const toDelete = backups.slice(maxBackups)
    for (const b of toDelete) {
      try {
        await this.deleteBackup(serverId, b.filename)
      } catch { /* ignore */ }
    }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
  }
}
