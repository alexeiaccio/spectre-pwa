import { createSignal } from 'solid-js'

/**
 * GS5: lightweight sync-status signal, updated by the sync runner (and any
 * future trigger) so screens can render synced / pending / offline states
 * without knowing the bridge internals. A module-level singleton — the UI
 * reads it with `syncStatus()` (or the hook-shaped `useSyncStatus()`), and the
 * runner writes it with `updateSyncStatus()`. The full paired-devices UI is
 * GS6; this is just the signal that UI reads.
 */
export interface SyncStatus {
  /** Epoch ms of the last completed inbound+outbound pass; null before the first. */
  lastSyncedAt: number | null
  /** Local records/tombstones not yet confirmed pushed to the doc (0 when converged). */
  pendingChanges: number
  /** Last observed relay connection (`relay_status()` → `connected=true`). */
  relayReachable: boolean
  /** A sync pass is in flight (for a subtle spinner). */
  syncing: boolean
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  lastSyncedAt: null,
  pendingChanges: 0,
  relayReachable: false,
  syncing: false,
}

const [status, setStatus] = createSignal<SyncStatus>(INITIAL_SYNC_STATUS)

/** Reactive read: `syncStatus()` returns the current snapshot in any component. */
export const syncStatus = status

/** Hook-shaped accessor, mirrors how screens consume `useVault`-style stores. */
export const useSyncStatus = (): (() => SyncStatus) => status

/** Merge a patch into the status (the runner calls this after each pass). */
export const updateSyncStatus = (patch: Partial<SyncStatus>): void => {
  setStatus((s) => ({ ...s, ...patch }))
}

/** Back to the pre-first-pass state (tests / teardown). */
export const resetSyncStatus = (): void => {
  setStatus({ ...INITIAL_SYNC_STATUS })
}
