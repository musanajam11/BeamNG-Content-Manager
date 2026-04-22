/**
 * ModSyncJoinerService — Tier 4 Phase 3 coop mod sharing (§3), joiner side.
 *
 * Responsibilities:
 *   1. Hash the joiner's local mod library and run `ModInventoryService.diff`
 *      against an incoming `WelcomeModManifest`.
 *   2. Stream-download missing mod zips over the host's HTTP share route
 *      (`/session/<token>/mod/<id>.zip?token=…`), verifying sha256 on the fly.
 *   3. Stage the downloaded files into a session-scoped folder (caller
 *      decides the path — staging conventions live in #19).
 *
 * Stays out of the controller's `EditorSyncSessionController` mainline; the
 * controller wires welcome → diff → emit, and exposes IPC methods that
 * delegate to this service. Decoupled so the diff/download path is unit-
 * testable without dragging the whole session in.
 */
import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, stat, unlink } from 'fs/promises'
import { dirname } from 'path'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { URL } from 'url'
import type { ModInfo } from '../../shared/types'
import {
  ModInventoryService,
  type ModDiffResult,
  type ModManifest,
} from './ModInventoryService'

export interface JoinerLocalMod {
  id: string
  version: string | null
  sha256: string
  filePath: string
}

export interface ModDownloadProgress {
  id: string
  received: number
  total: number
  done: boolean
  error?: string
}

export interface ModDownloadOffer {
  id: string
  url: string
  sha256: string
  sizeBytes: number
  fileName: string
}

export class ModSyncJoinerService {
  constructor(private readonly inventory: ModInventoryService = new ModInventoryService()) {}

  /**
   * Hash every local mod file and produce the `JoinerLocalMod[]` shape that
   * `ModInventoryService.diff` expects. Skips entries whose file is missing
   * or unreadable rather than failing the whole batch — a single corrupt
   * entry shouldn't gate the joiner from coop.
   *
   * Hashing 100 mods @ ~50 MB averages out to <10 s on an SSD; we run them
   * sequentially to keep IO predictable. If this becomes a UX problem later,
   * worker-thread sharding is the obvious next step.
   */
  async hashLocalMods(mods: ModInfo[]): Promise<JoinerLocalMod[]> {
    const out: JoinerLocalMod[] = []
    for (const mod of mods) {
      try {
        await stat(mod.filePath)
      } catch {
        continue
      }
      let sha: string
      try {
        sha = await this.inventory.sha256File(mod.filePath)
      } catch {
        continue
      }
      out.push({
        id: mod.key,
        version: mod.version ?? null,
        sha256: sha,
        filePath: mod.filePath,
      })
    }
    return out
  }

  /**
   * Convenience: hash + diff in one call. Mirrors the most common call site.
   */
  async runDiff(manifest: ModManifest, mods: ModInfo[]): Promise<{
    diff: ModDiffResult
    localMods: JoinerLocalMod[]
    downloadSizeBytes: number
  }> {
    const localMods = await this.hashLocalMods(mods)
    const diffShape = localMods.map((m) => ({ id: m.id, version: m.version, sha256: m.sha256 }))
    const diff = this.inventory.diff(manifest, diffShape)
    const downloadSizeBytes = this.inventory.downloadSizeBytes(manifest, diff)
    return { diff, localMods, downloadSizeBytes }
  }

  /**
   * Stream-download a single `ModDownloadOffer` to `destPath`, verifying
   * sha256 as bytes flow. Removes the partial file on any error or hash
   * mismatch so a retry starts clean. `onProgress` is called at most once
   * per HTTP `data` event — the caller is expected to throttle for UI
   * if needed.
   */
  async downloadOffer(
    offer: ModDownloadOffer,
    destPath: string,
    onProgress?: (p: ModDownloadProgress) => void,
  ): Promise<void> {
    await mkdir(dirname(destPath), { recursive: true })
    const url = new URL(offer.url)
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
    await new Promise<void>((resolve, reject) => {
      const req = transport(url, { method: 'GET' }, (res) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode ?? '?'} fetching mod ${offer.id}`))
          return
        }
        const declared = Number(res.headers['content-length'] ?? offer.sizeBytes ?? 0)
        const hash = createHash('sha256')
        const out = createWriteStream(destPath)
        let received = 0
        let aborted = false
        const fail = (err: Error) => {
          if (aborted) return
          aborted = true
          try { res.destroy() } catch { /* ignore */ }
          try { out.destroy() } catch { /* ignore */ }
          unlink(destPath).catch(() => { /* ignore */ })
          onProgress?.({ id: offer.id, received, total: declared, done: false, error: err.message })
          reject(err)
        }
        res.on('error', fail)
        out.on('error', fail)
        res.on('data', (chunk: Buffer) => {
          hash.update(chunk)
          received += chunk.length
          onProgress?.({ id: offer.id, received, total: declared, done: false })
        })
        res.on('end', () => {
          out.end(() => {
            const got = hash.digest('hex')
            if (got !== offer.sha256) {
              fail(new Error(`sha256 mismatch for ${offer.id}: expected ${offer.sha256}, got ${got}`))
              return
            }
            onProgress?.({ id: offer.id, received, total: declared, done: true })
            resolve()
          })
        })
        res.pipe(out, { end: false })
      })
      req.on('error', (err) => {
        unlink(destPath).catch(() => { /* ignore */ })
        reject(err)
      })
      req.end()
    })
  }

  /**
   * Re-hash a freshly downloaded file end-to-end as a defence-in-depth
   * check before staging it into BeamNG's mods folder. Cheap (one extra
   * disk read) and catches the rare case where the streaming hash above
   * was correct but the on-disk bytes drifted (AV-quarantine, etc.).
   */
  async verifyOnDisk(filePath: string, expectedSha: string): Promise<boolean> {
    try {
      const got = await this.inventory.sha256File(filePath)
      return got === expectedSha
    } catch {
      return false
    }
  }
}

// Suppress unused-import warning in builds where createReadStream isn't
// consumed (kept available for future incremental verify modes).
void createReadStream
