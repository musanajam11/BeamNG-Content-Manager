import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Per-file open state for the Dev Tools UI Files editor. Mirrors the
 * `OpenFileState` interface in LuaUIFilesPanel.tsx — duplicated here to keep
 * the store decoupled from the component module (avoids circular imports).
 */
export interface DevEditorOpenFile {
  /** root-relative path */
  path: string
  rootId: string
  /** Saved (= what's on disk now). */
  savedContent: string
  /** Editor buffer (= what user typed). */
  bufferContent: string
  language: string
}

interface DevEditorState {
  /**
   * Open file buffers, keyed by `${rootId}\u0000${subPath}`.
   * Stored as a plain Record so the persist middleware can serialize it.
   */
  openFiles: Record<string, DevEditorOpenFile>
  setOpenFiles: (files: Record<string, DevEditorOpenFile>) => void
  clear: () => void
}

/**
 * Persists Dev Tools editor buffers across navigation (and restarts) so the
 * user does not lose unsaved edits when leaving the page. Saved/committed
 * state is owned by the main process; this store only mirrors the in-memory
 * editor working copy.
 */
export const useDevEditorStore = create<DevEditorState>()(
  persist(
    (set) => ({
      openFiles: {},
      setOpenFiles: (files) => set({ openFiles: files }),
      clear: () => set({ openFiles: {} }),
    }),
    { name: 'beammp-dev-editor-buffers.v1' }
  )
)
