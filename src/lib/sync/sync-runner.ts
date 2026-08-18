import { createEffect, onCleanup } from 'solid-js'
import { Effect } from 'effect'
import { getSyncAdapter, SYNC_EXPERIMENTAL } from './adapter.ts'
import {
  diffVault,
  getLastPushed,
  pushChanges,
  syncNow,
  updateHostPointer,
} from './bridge.ts'
import { readMeta, readNodeIdentity } from '../vault/storage.ts'
import { vaultImpl } from '../vault/service.ts'
import { syncStatus, updateSyncStatus } from './sync-status.ts'
import type { Vault } from '../vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

/**
 * GS5: how often the in-app timer fires while the app is open. 30s bounds the
 * window between a local edit and the doc write when the save-triggered
 * `pushSave` can't run (e.g. the edit happened while offline), and doubles as
 * an in-app relay keepalive for the wasm engine (the iroh-worker keepalive is
 * a separate follow-up). Hidden tabs get throttled to ~1/min by the browser —
 * fine, the pass gates on `document.hidden` anyway.
 */
export const SYNC_INTERVAL_MS = 30_000

const EMPTY_VAULT: Vault = { formatVersion: 1, identities: [] }

/** Guards overlapping passes (timer + visibility + online can fire together). */
let inFlight = false

/** `relay_status()` renders `"<url> connected=true ; …"` (crates/spectre-sync). */
export const parseRelayReachable = (relayStatus: string): boolean =>
  relayStatus.includes('connected=true')

/** Pure gate: experimental sync is on AND the tab is in the foreground. */
export const shouldRunSyncPass = (opts: { hidden: boolean }): boolean =>
  SYNC_EXPERIMENTAL && !opts.hidden

const relayReachableNow = (): boolean => syncStatus().relayReachable

const noop = (pendingChanges: number): SyncPassResult => ({
  ran: false,
  pushed: 0,
  pendingChanges,
  relayReachable: relayReachableNow(),
})

export interface SyncPassResult {
  /** True when a pass actually ran (doc joined + vault unlocked). */
  ran: boolean
  /** Records/tombstones written to the doc by this pass. */
  pushed: number
  /** Local changes not yet confirmed pushed to the doc. */
  pendingChanges: number
  relayReachable: boolean
}

/**
 * One inbound+outbound sync pass (GS5):
 *
 * - **Inbound** — `syncNow()` re-reads the union of host-pointer ids + local
 *   mirror ids from the doc into the mirror (records are encrypted under the
 *   group key K; the doc already resolved LWW by uuid).
 * - **Outbound** — diff the live vault against the last confirmed push (the
 *   bridge's watermark) and write the changes back under K (records +
 *   tombstones), refreshing the host pointer. Write-on-change: no diff, no
 *   write — no ping-pong between devices.
 * - **Status** — refreshes the sync-status signal with lastSyncedAt,
 *   pendingChanges and relayReachable.
 *
 * Skips (no-op) while the tab is hidden, while a pass is already in flight,
 * before a doc is joined, or while the vault is locked (no session → no K for
 * the outbound half; inbound is pointless without the UI needing it).
 */
export const runSyncPass = async (): Promise<SyncPassResult> => {
  const hidden = typeof document !== 'undefined' && document.hidden
  if (!shouldRunSyncPass({ hidden }) || inFlight) {
    return noop(syncStatus().pendingChanges)
  }
  inFlight = true
  updateSyncStatus({ syncing: true })
  try {
    const node = await run(readNodeIdentity())
    const session = await run(vaultImpl.session())
    if (!node?.docId || !session) {
      updateSyncStatus({ syncing: false })
      return noop(syncStatus().pendingChanges)
    }

    // Inbound half: pull known keys into the mirror (records under K).
    await syncNow()

    // Outbound half: write-on-change against the bridge's confirmed-push
    // watermark; a failed push leaves pending > 0 for the next pass to retry.
    const diff = diffVault(getLastPushed() ?? EMPTY_VAULT, session.vault)
    const pending = diff.changed.length + diff.removedIds.length
    let pushed = 0
    try {
      const meta = await run(readMeta())
      if (pending > 0 && meta?.deviceId) {
        const sync = getSyncAdapter()
        await sync.start()
        await pushChanges(sync, node.docId, meta.deviceId, session.dek, diff)
        await updateHostPointer(sync, node.docId, meta.deviceId, session.vault)
        pushed = pending
      }
    } catch {
      // Push failed (relay down / wasm error): pending stays > 0; next pass retries.
    }

    let relayReachable = relayReachableNow()
    try {
      relayReachable = parseRelayReachable(await getSyncAdapter().relayStatus())
    } catch {
      relayReachable = false
    }

    const pendingChanges = pushed === pending ? 0 : pending
    updateSyncStatus({
      lastSyncedAt: Date.now(),
      pendingChanges,
      relayReachable,
      syncing: false,
    })
    return { ran: true, pushed, pendingChanges, relayReachable }
  } catch {
    updateSyncStatus({ syncing: false })
    return noop(syncStatus().pendingChanges)
  } finally {
    inFlight = false
  }
}

export interface SyncRunnerHandle {
  stop(): void
}

/**
 * Register the GS5 triggers: an immediate pass on start (app open), the
 * recurring in-app timer while open, `visibilitychange` → visible, and
 * `online`. The identities-screen trigger is the fifth and already lives in
 * the screen (inbound `syncNow`; the runner's timer covers the outbound half
 * shortly after). All handlers gate on `document.hidden`, so hidden-tab timer
 * throttling never produces a visible pass.
 */
export const startSyncRunner = (
  opts: { intervalMs?: number } = {},
): SyncRunnerHandle => {
  const intervalMs = opts.intervalMs ?? SYNC_INTERVAL_MS

  const onForeground = (): void => {
    if (!document.hidden) void runSyncPass()
  }

  // App open: first pass (no-ops while locked / before a doc is joined).
  onForeground()

  document.addEventListener('visibilitychange', onForeground)
  window.addEventListener('online', onForeground)
  const timer = window.setInterval(onForeground, intervalMs)

  return {
    stop(): void {
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('online', onForeground)
      window.clearInterval(timer)
    },
  }
}

/** Solid hook: start the runner on mount, stop it on unmount (used by App). */
export function useSyncRunner(opts: { intervalMs?: number } = {}): void {
  // Solid 2 beta: createEffect requires the (compute, effect) two-arg form.
  createEffect(
    () => opts,
    () => {
      const handle = startSyncRunner(opts)
      onCleanup(() => handle.stop())
    },
  )
}
