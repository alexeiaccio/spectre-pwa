import { Effect } from 'effect'
import { getSyncAdapter, SYNC_EXPERIMENTAL } from './adapter.ts'
import type { SyncAdapter } from './adapter.ts'
import { encodeIdentityRecord } from './records.ts'
import {
  HOST_KEY,
  decodeHostDoc,
  decodeRecordDoc,
  encodeHostDoc,
  encodeRecordDoc,
  type HostPointer,
} from './types.ts'
import {
  getAllRecords,
  readMeta,
  readNodeIdentity,
  writeRecord,
} from '../vault/storage.ts'
import { vaultImpl } from '../vault/service.ts'
import type { Identity, Vault } from '../vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

export interface VaultDiff {
  changed: Identity[]
  removedIds: string[]
}

/**
 * Which identities a save actually changed (M5: write-on-change, no ping-pong).
 * Deep-equality via JSON — a site CRUD or identity edit changes the JSON.
 */
export const diffVault = (prev: Vault, next: Vault): VaultDiff => {
  const prevById = new Map(prev.identities.map((i) => [i.id, i]))
  const changed: Identity[] = []
  for (const identity of next.identities) {
    const before = prevById.get(identity.id)
    if (!before || JSON.stringify(before) !== JSON.stringify(identity)) {
      changed.push(identity)
    }
  }
  const removedIds = [...prevById.keys()].filter(
    (id) => !next.identities.some((i) => i.id === id),
  )
  return { changed, removedIds }
}

/** Push a diff to the doc: changed identities as records, removals as tombstones (S2/M5). */
export const pushChanges = async (
  sync: SyncAdapter,
  docId: string,
  deviceId: string,
  dek: CryptoKey,
  diff: VaultDiff,
): Promise<void> => {
  for (const identity of diff.changed) {
    const record = await run(encodeIdentityRecord(dek, identity, deviceId))
    await sync.set(docId, identity.id, encodeRecordDoc(record))
  }
  for (const id of diff.removedIds) {
    await sync.set(docId, id, encodeRecordDoc({ v: 2, kind: 'tombstone' }))
  }
}

/**
 * Re-read known keys from the doc into the mirror **as-received** (M5: store under
 * the writer's DEK, no re-encryption on receipt — the doc already resolved LWW).
 * Foreign-writer records are read lazily via the writer's envelope + recovery code.
 */
const mergeIncoming = async (
  sync: SyncAdapter,
  docId: string,
  ids: ReadonlyArray<string>,
): Promise<number> => {
  let merged = 0
  for (const id of ids) {
    const value = await sync.get(docId, id)
    if (!value) continue
    const record = decodeRecordDoc(value)
    await run(writeRecord(id, record))
    merged++
  }
  return merged
}

/** Keep the host pointer's identityIds current so inbound merges know the keys. */
const updateHostPointer = async (
  sync: SyncAdapter,
  docId: string,
  deviceId: string,
  vault: Vault,
): Promise<void> => {
  const host: HostPointer = {
    deviceId,
    identityIds: vault.identities.map((i) => i.id),
  }
  await sync.set(docId, HOST_KEY, encodeHostDoc(host))
}

/**
 * The outbound half, fired after a local save: if a vault doc is persisted and
 * sync is experimental-enabled, push the diff (records + tombstones) and refresh
 * the host pointer. Fire-and-forget; failures are swallowed (live sync is
 * experimental per S7 — the mirror is the durable source of truth).
 */
export const pushSave = async (
  prev: Vault | null,
  next: Vault,
): Promise<void> => {
  if (!SYNC_EXPERIMENTAL) return
  try {
    const node = await run(readNodeIdentity())
    if (!node?.docId) return
    const session = await run(vaultImpl.session())
    if (!session) return
    const meta = await run(readMeta())
    if (!meta?.deviceId) return
    const sync = getSyncAdapter()
    await sync.start()
    const diff = diffVault(prev ?? { formatVersion: 1, identities: [] }, next)
    if (diff.changed.length === 0 && diff.removedIds.length === 0) return
    await pushChanges(sync, node.docId, meta.deviceId, session.dek, diff)
    await updateHostPointer(sync, node.docId, meta.deviceId, next)
  } catch {
    // best-effort: the mirror already has the change
  }
}

/**
 * The inbound half, fired when the app reaches the identities screen with a
 * persisted doc: poll the union of the host pointer's ids + local mirror ids
 * and re-read them into the mirror (LWW resolved by the doc).
 */
export const syncNow = async (): Promise<void> => {
  if (!SYNC_EXPERIMENTAL) return
  try {
    const node = await run(readNodeIdentity())
    if (!node?.docId) return
    const sync = getSyncAdapter()
    await sync.start()
    const hostStr = await sync.get(node.docId, HOST_KEY)
    const hostIds = hostStr ? decodeHostDoc(hostStr).identityIds : []
    const localIds = (await run(getAllRecords())).map(([id]) => id)
    await mergeIncoming(
      sync,
      node.docId,
      Array.from(new Set([...hostIds, ...localIds])),
    )
  } catch {
    // best-effort: live sync is experimental
  }
}
