import { expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  generateDek,
  kekFromPrf,
  wrapDek,
} from '../../src/lib/vault/crypto-dek.ts'
import { diffVault, pushChanges } from '../../src/lib/sync/bridge.ts'
import type { SyncAdapter } from '../../src/lib/sync/adapter.ts'
import {
  adoptHostCode,
  encodeIdentityRecord,
  unwrapRecoveryDek,
} from '../../src/lib/sync/records.ts'
import { decodeRecordDoc, encodeRecordDoc } from '../../src/lib/sync/types.ts'
import type { Identity, Vault } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const IDENTITY_A: Identity = {
  id: 'id-a',
  fullName: 'Ada',
  algorithm: 3,
  sites: [
    {
      id: 's1',
      name: 'twitter.com',
      counter: 1,
      template: 17,
      purpose: 'password',
    },
  ],
}
const IDENTITY_B: Identity = {
  id: 'id-b',
  fullName: 'Bob',
  algorithm: 3,
  sites: [],
}

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

test('adoptHostCode merges host + local identities under a rotated DEK wrapped by the host code', async () => {
  const HOST_CODE = 'host-code-xxxxxxxx'
  // Host fixture: a DEK + envelope (recovery wrap) + one record (host-only identity).
  const { key: hostDek, raw: hostRaw } = await Effect.runPromise(generateDek())
  const hSalt = crypto.getRandomValues(new Uint8Array(16))
  const hKek = await Effect.runPromise(
    kekFromPrf(new TextEncoder().encode(HOST_CODE), hSalt),
  )
  const hWrapped = await Effect.runPromise(wrapDek(hostRaw, hKek))
  const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer
  const hostEnvelope = {
    v: 1,
    deviceId: 'host-a',
    deks: [
      {
        method: 'recovery',
        salt: toBuf(hSalt),
        iv: toBuf(hWrapped.iv),
        wrapped: toBuf(hWrapped.wrapped),
      },
    ],
  }
  const hostOnly: Identity = {
    id: 'host-only',
    fullName: 'Host',
    algorithm: 3,
    sites: [],
  }
  const hostRecord = await Effect.runPromise(
    encodeIdentityRecord(hostDek, hostOnly, 'host-a'),
  )

  // B's existing vault has a conflicting identity (kept) + B-only identities.
  const localConflicting: Identity = {
    id: 'both',
    fullName: 'Local B',
    algorithm: 3,
    sites: [],
  }
  const localOnly: Identity = {
    id: 'local-only',
    fullName: 'Local',
    algorithm: 3,
    sites: [],
  }
  // Host also has 'both' (LWW: local wins on conflict).
  const hostBoth: Identity = {
    id: 'both',
    fullName: 'Host Both',
    algorithm: 3,
    sites: [],
  }
  const hostBothRecord = await Effect.runPromise(
    encodeIdentityRecord(hostDek, hostBoth, 'host-a'),
  )

  const joined = await Effect.runPromise(
    adoptHostCode({
      hostEnvelope,
      hostRecords: new Map([
        ['host-only', hostRecord],
        ['both', hostBothRecord],
      ]),
      hostCode: HOST_CODE,
      localVault: vaultOf(localConflicting, localOnly),
      deviceId: 'device-b',
      passkeyPrf: crypto.getRandomValues(new Uint8Array(32)),
      passkeyPrfSalt: crypto.getRandomValues(new Uint8Array(32)),
      passkeyCredId: 'cred-b',
    }),
  )

  const ids = joined.identities.map((i) => i.id).sort()
  expect(ids).toEqual(['both', 'local-only', 'host-only'].sort())
  // Conflict resolved to B's copy.
  const both = joined.identities.find((i) => i.id === 'both')!
  expect(both.fullName).toBe('Local B')
  // Records decrypt under the rotated DEK (via the adopted host code).
  const dekViaCode = await Effect.runPromise(
    unwrapRecoveryDek(joined.envelope, HOST_CODE),
  )
  const decrypted: string[] = []
  for (const record of joined.records.values()) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(record.iv) },
      dekViaCode,
      new Uint8Array(record.ct),
    )
    decrypted.push((JSON.parse(new TextDecoder().decode(pt)) as Identity).id)
  }
  expect(decrypted.sort()).toEqual(ids)
  // B's old code no longer unlocks the new envelope.
  await expect(
    Effect.runPromise(unwrapRecoveryDek(joined.envelope, 'b-olds-code-xxxxx')),
  ).rejects.toThrow(/wrong/i)
})
