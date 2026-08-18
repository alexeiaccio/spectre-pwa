import { beforeEach, describe, expect, test } from 'vitest'
import {
  INITIAL_SYNC_STATUS,
  resetSyncStatus,
  syncStatus,
  updateSyncStatus,
  useSyncStatus,
} from '../../src/lib/sync/sync-status.ts'
import {
  parseRelayReachable,
  shouldRunSyncPass,
  SYNC_INTERVAL_MS,
} from '../../src/lib/sync/sync-runner.ts'

describe('sync status signal (GS5)', () => {
  beforeEach(() => resetSyncStatus())

  test('defaults to unsynced / nothing pending / relay unknown', () => {
    expect(syncStatus()).toEqual(INITIAL_SYNC_STATUS)
    expect(useSyncStatus()()).toEqual({
      lastSyncedAt: null,
      pendingChanges: 0,
      relayReachable: false,
      syncing: false,
    })
  })

  test('updateSyncStatus merges patches and keeps the rest of the snapshot', () => {
    updateSyncStatus({ lastSyncedAt: 1234 })
    expect(syncStatus().lastSyncedAt).toBe(1234)
    expect(syncStatus().pendingChanges).toBe(0)

    updateSyncStatus({ pendingChanges: 3, relayReachable: true })
    expect(syncStatus()).toEqual({
      lastSyncedAt: 1234,
      pendingChanges: 3,
      relayReachable: true,
      syncing: false,
    })
  })

  test('resetSyncStatus restores the pre-first-pass state', () => {
    updateSyncStatus({ lastSyncedAt: 99, pendingChanges: 2, relayReachable: true })
    resetSyncStatus()
    expect(syncStatus()).toEqual(INITIAL_SYNC_STATUS)
  })
})

describe('sync runner gates (GS5)', () => {
  test('a pass runs only when the tab is foregrounded and sync is enabled', () => {
    expect(shouldRunSyncPass({ hidden: false })).toBe(true)
    expect(shouldRunSyncPass({ hidden: true })).toBe(false)
  })

  test('the in-app timer interval is a sane positive value', () => {
    expect(SYNC_INTERVAL_MS).toBeGreaterThan(0)
    expect(SYNC_INTERVAL_MS).toBeLessThanOrEqual(60_000)
  })

  test('relay reachability is parsed from relay_status() output', () => {
    expect(
      parseRelayReachable('https://relay0.iroh.accio.blue/ connected=true'),
    ).toBe(true)
    expect(
      parseRelayReachable('https://relay0.iroh.accio.blue/ connected=false'),
    ).toBe(false)
    expect(parseRelayReachable('')).toBe(false)
  })
})
