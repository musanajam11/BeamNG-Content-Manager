import { create } from 'zustand'
import type {
  SessionOp,
  SessionLogEntry,
  PeerPoseEntry,
  PeerActivity,
} from '../../../shared/types'

/**
 * Persistent buffer for the World Editor Sync session UI.
 *
 * Why this exists: previously these arrays were `useState` inside
 * `WorldEditSessionPage`, and the IPC subscriptions also lived there. As
 * soon as the user navigated away (e.g. to Vehicles or Settings) the
 * component unmounted, dropped the subscriptions, and the op stream history
 * was wiped — coming back to the page showed an empty list even mid-session.
 *
 * Now the store outlives any one page and the subscriptions are wired once
 * at the App-shell level (see `App.tsx`), so navigating away and back keeps
 * the full op/log/peer history intact.
 */

const MAX_OPS = 500
const MAX_LOG = 300

interface State {
  ops: SessionOp[]
  logEntries: SessionLogEntry[]
  poses: Record<string, PeerPoseEntry>
  activity: Record<string, PeerActivity>
  /** `Date.now()` ts per authorId — used to drive the brief yellow flash. */
  activityPulse: Record<string, number>

  pushOp: (op: SessionOp) => void
  pushLog: (entry: SessionLogEntry) => void
  setPose: (pose: PeerPoseEntry) => void
  setActivity: (act: PeerActivity) => void
  clearOps: () => void
  clearLog: () => void
  /** Wipe everything — used when the user explicitly leaves the session. */
  reset: () => void
}

export const useWorldEditSessionStore = create<State>((set) => ({
  ops: [],
  logEntries: [],
  poses: {},
  activity: {},
  activityPulse: {},

  pushOp: (op) =>
    set((s) => {
      const next = [...s.ops, op]
      return { ops: next.length > MAX_OPS ? next.slice(next.length - MAX_OPS) : next }
    }),

  pushLog: (entry) =>
    set((s) => {
      const next = [...s.logEntries, entry]
      return { logEntries: next.length > MAX_LOG ? next.slice(next.length - MAX_LOG) : next }
    }),

  setPose: (pose) =>
    set((s) => ({ poses: { ...s.poses, [pose.authorId]: pose } })),

  setActivity: (act) =>
    set((s) => ({
      activity: { ...s.activity, [act.authorId]: act },
      activityPulse: { ...s.activityPulse, [act.authorId]: Date.now() },
    })),

  clearOps: () => set({ ops: [] }),
  clearLog: () => set({ logEntries: [] }),

  reset: () =>
    set({ ops: [], logEntries: [], poses: {}, activity: {}, activityPulse: {} }),
}))
