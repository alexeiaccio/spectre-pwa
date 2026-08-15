import { expect, test } from 'vitest'
import { Effect } from 'effect'
import { diffVault, pushChanges } from '../../src/lib/sync/bridge.ts'
import type { SyncAdapter } from '../../src/lib/sync/adapter.ts'
import { encodeIdentityRecord } from '../../src/lib/sync/records.ts'
import { decodeRecordDoc, encodeRecordDoc } from '../../src/lib/sync/types.ts'
import type { Identity, Vault } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const IDENTITY_A: Identity = {
  id: 'id-a',
  fullName: 'Ada',
  algorithm: 3,
  sites: [{ id: 's1', name: 'twitter.com', counter: 1, template: 17, purpose: 'password' }],
}
const IDENTITY_B: Identity = { id: 'id-b', fullName: 'Bob', algorithm: 3, sites: [] }

const vaultOf = (...identities: Identity[]): Vault => ({
  formatVersion: 1,
  identities,
})

/** In-memory SyncAdapter: a plain key/value doc. */
class MemoryAdapter implements SyncAdapter {
  experimental = true
  readonly store = new Map<string, string>()
  async start(): Promise<void> {}
  async createDoc(): Promise<{ docId: string; ticket: string }> {
    throw new Error('n/a')
  }
  async joinDoc(): Promise<{ docId: string }> {
    throw new Error('n/a')
  }
  docIdFromTicket(): string {
    return 'doc'
  }
  async subscribe(): Promise<void> {}
  async get(_docId: string, key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }
  async set(_docId: string, key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }
  async syncStatus(): Promise<string> {
    return 'ok'
  }
}

test('diffVault reports changed and removed identities', () => {
  const edited: Identity = { ...IDENTITY_A, sites: [] }
  const diff = diffVault(vaultOf(IDENTITY_A, IDENTITY_B), vaultOf(edited))
  expect(diff.changed.map((i) => i.id)).toEqual(['id-a'])
  expect(diff.removedIds).toEqual(['id-b'])

  const noop = diffVault(vaultOf(IDENTITY_A), vaultOf(IDENTITY_A))
  expect(noop.changed).toEqual([])
  expect(noop.removedIds).toEqual([])
})

test('pushChanges writes changed records under the device writer and tombstones removals', async () => {
  const adapter = new MemoryAdapter()
  const dek = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const diff = diffVault(vaultOf(IDENTITY_A, IDENTITY_B), vaultOf(IDENTITY_A))
  await pushChanges(adapter, 'doc', 'device-1', dek, diff)

  // The changed identity (A unchanged → not pushed; B removed → tombstone).
  expect(adapter.store.has('id-b')).toBe(true)
  expect(decodeRecordDoc(adapter.store.get('id-b')!)).toEqual({
    v: 2,
    kind: 'tombstone',
  })
  // A was unchanged → no doc write (write-on-change, no ping-pong).
  expect(adapter.store.has('id-a')).toBe(false)
})

test('pushChanges writes a genuinely changed identity with the device as writer', async () => {
  const adapter = new MemoryAdapter()
  const dek = await crypto.subtle.importKey(
    'raw',
    crypto.getRandomValues(new Uint8Array(32)),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  const edited: Identity = { ...IDENTITY_A, fullName: 'Ada 2' }
  const diff = diffVault(vaultOf(IDENTITY_A), vaultOf(edited))
  await pushChanges(adapter, 'doc', 'device-1', dek, diff)

  const record = decodeRecordDoc(adapter.store.get('id-a')!)
  expect(record.kind).toBe('record')
  if (record.kind !== 'record') throw new Error('expected record')
  expect(record.writer).toBe('device-1')
  // Decrypts back to the edited identity.
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
    dek,
    new Uint8Array(record.ct),
  )
  expect(JSON.parse(new TextDecoder().decode(pt))).toEqual(edited)
})
