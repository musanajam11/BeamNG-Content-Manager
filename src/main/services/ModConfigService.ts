// Generic loader/writer for server-mod JSON configs. See
// shared/modConfigDescriptors.ts for the descriptor list.
//
// Path safety: every relPath is normalised and checked to live inside the
// descriptor directory; absolute paths and `..` traversal are rejected.

import { existsSync } from 'fs'
import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import { isAbsolute, join, normalize, relative, sep } from 'path'
import {
  MOD_CONFIG_DESCRIPTORS,
  type ModConfigBundle,
  type ModConfigDescriptor,
  type ModConfigFile,
} from '../../shared/modConfigDescriptors'

function findDescriptor(id: string): ModConfigDescriptor | null {
  return MOD_CONFIG_DESCRIPTORS.find((d) => d.id === id) ?? null
}

function isInstalled(serverDir: string, desc: ModConfigDescriptor): boolean {
  const markers = desc.installMarkers && desc.installMarkers.length > 0
    ? desc.installMarkers
    : [desc.dirRelative]
  return markers.some((m) => existsSync(join(serverDir, m)))
}

/** Reject absolute paths and any `..` segment that would escape `baseDir`. */
function safeJoin(baseDir: string, relPath: string): string | null {
  if (isAbsolute(relPath)) return null
  const full = normalize(join(baseDir, relPath))
  const rel = relative(baseDir, full)
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return null
  return full
}

async function listJsonFiles(dirAbs: string, explicit?: string[]): Promise<string[]> {
  if (explicit && explicit.length > 0) return explicit
  try {
    const entries = await readdir(dirAbs, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.json'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

async function readFileEntry(dirAbs: string, relPath: string): Promise<ModConfigFile> {
  const full = safeJoin(dirAbs, relPath)
  if (!full) {
    return { relPath, exists: false, content: null, parseError: 'Invalid path' }
  }
  if (!existsSync(full)) {
    return { relPath, exists: false, content: null }
  }
  try {
    const raw = await readFile(full, 'utf-8')
    // Strip BOM if present — some BeamMP plugin configs ship with one.
    const stripped = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw
    try {
      const content = JSON.parse(stripped)
      return { relPath, exists: true, content, raw }
    } catch (e) {
      return { relPath, exists: true, content: null, raw, parseError: String(e) }
    }
  } catch (e) {
    return { relPath, exists: false, content: null, parseError: String(e) }
  }
}

export class ModConfigService {
  listDescriptors(): ModConfigDescriptor[] {
    return MOD_CONFIG_DESCRIPTORS
  }

  async loadBundle(serverDir: string, descriptorId: string): Promise<ModConfigBundle | null> {
    const desc = findDescriptor(descriptorId)
    if (!desc) return null
    const dirAbs = join(serverDir, desc.dirRelative)
    const installed = isInstalled(serverDir, desc)
    if (!installed) {
      return { descriptorId, installed: false, absDir: dirAbs, files: [] }
    }
    const names = await listJsonFiles(dirAbs, desc.files)
    const files: ModConfigFile[] = []
    for (const name of names) {
      files.push(await readFileEntry(dirAbs, name))
    }
    return { descriptorId, installed: true, absDir: dirAbs, files }
  }

  async saveFile(
    serverDir: string,
    descriptorId: string,
    relPath: string,
    content: unknown,
  ): Promise<{ success: boolean; error?: string }> {
    const desc = findDescriptor(descriptorId)
    if (!desc) return { success: false, error: `Unknown descriptor: ${descriptorId}` }
    if (!isInstalled(serverDir, desc)) {
      return { success: false, error: `${desc.displayName} is not installed in this server.` }
    }
    const dirAbs = join(serverDir, desc.dirRelative)
    const full = safeJoin(dirAbs, relPath)
    if (!full) return { success: false, error: 'Invalid relative path.' }
    try {
      await mkdir(dirAbs, { recursive: true })
      // Verify we're not silently overwriting a directory.
      if (existsSync(full)) {
        const s = await stat(full)
        if (!s.isFile()) return { success: false, error: 'Target is not a file.' }
      }
      const json = JSON.stringify(content, null, 2)
      await writeFile(full, json, 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }
}
