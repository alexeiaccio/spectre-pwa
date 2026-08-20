import { expect, test } from 'vitest'
import { Effect } from 'effect'
import type { SyncAdapter } from '../../src/lib/sync/adapter.ts'
import {
  createGroupInvitation,
  decodeInvitation,
  encodeInvitation,
  rotateGroupInvitation,
} from '../../src/lib/sync/invitation.ts'
import {
  consentGroupJoin,
  decodeIdentityRecord,
} from '../../src/lib/sync/records.ts'
import {
  generateGroupKey,
  importGroupKey,
  unwrapGroupKeyFromShare,
  unwrapGroupKeyLocal,
} from '../../src/lib/sync/group.ts'
import {
  HOST_KEY,
  decodeHostDoc,
  decodeRecordDoc,
  type SyncRecord,
} from '../../src/lib/sync/types.ts'
import type { Identity } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const id = (n: number): Identity => ({
  id: `id-${n}`,
  fullName: `Identity ${n}`,
  algorithm: 3,
  sites: [],
})

/** In-memory doc adapter with a working createDoc (covers GS2's write path). */
class MemoryAdapter implements SyncAdapter {
  experimental = true
  readonly store = new Map<string, string>()
  async start(): Promise<void> {}
  async createDoc(): Promise<{ docId: string; ticket: string }> {
    return { docId: 'doc-1', ticket: 'ticket-1' }
  }
  async joinDoc(): Promise<{ docId: string }> {
    throw new Error('n/a')
  }
  docIdFromTicket(): string {
    return 'doc-1'
  }
  async reopen(): Promise<void> {}
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
  async relayStatus(): Promise<string> {
    return 'connected'
  }
  async syncPeers(): Promise<string> {
    return ''
  }
  async nodeId(): Promise<string> {
    return 'node'
  }
}

test('invitation round-trips through the JSON wire format', () => {
  const inv = {
    v: 1 as const,
    ticket: 'ticket-x',
    groupId: 'g1',
    secret: new Uint8Array([1, 2, 3]),
    share: {
      salt: new Uint8Array([4]),
      iv: new Uint8Array([5]),
      ct: new Uint8Array([6]),
    },
  }
  expect(decodeInvitation(encodeInvitation(inv))).toEqual(inv)
})

test('createGroupInvitation shares ONLY the chosen identities, under the group key', async () => {
  const adapter = new MemoryAdapter()
  const all = [id(1), id(2), id(3)]
  const selected = [all[0], all[1]] // id-1, id-2; id-3 must stay out
  const { key: _k, raw } = await run(generateGroupKey())

  const inviteStr = await createGroupInvitation({
    sync: adapter,
    groupId: 'g1',
    deviceId: 'host',
    identities: selected,
    groupKeyRaw: new Uint8Array(raw),
  })
  raw.fill(0)

  // Host pointer lists only the chosen ids.
  const host = decodeHostDoc(adapter.store.get(HOST_KEY)!)
  expect(host.identityIds).toEqual(['id-1', 'id-2'])

  // Only chosen identities are in the doc; the unselected one never appears.
  expect(adapter.store.has('id-1')).toBe(true)
  expect(adapter.store.has('id-2')).toBe(true)
  expect(adapter.store.has('id-3')).toBe(false)

  // The joiner recovers K from the invitation and reads a chosen identity.
  const inv = decodeInvitation(inviteStr)
  expect(inv.groupId).toBe('g1')
  expect(inv.ticket).toBe('ticket-1')
  const rawK = await run(
    unwrapGroupKeyFromShare(new Uint8Array(inv.secret), {
      salt: new Uint8Array(inv.share.salt),
      iv: new Uint8Array(inv.share.iv),
      ct: new Uint8Array(inv.share.ct),
    }),
  )
  const k = await run(importGroupKey(rawK))
  const reader = decodeRecordDoc(adapter.store.get('id-1')!)
  const identity = await run(decodeIdentityRecord(k, reader))
  expect(identity.fullName).toBe('Identity 1')
})

test('createGroupInvitation rejects an empty selection', async () => {
  const adapter = new MemoryAdapter()
  const { raw } = await run(generateGroupKey())
  await expect(
    createGroupInvitation({
      sync: adapter,
      groupId: 'g1',
      deviceId: 'host',
      identities: [],
      groupKeyRaw: new Uint8Array(raw),
    }),
  ).rejects.toThrow(/no identities selected/)
  raw.fill(0)
})

test('rotateGroupInvitation issues a fresh secret; the old one can no longer unwrap K', async () => {
  const adapter = new MemoryAdapter()
  const { raw } = await run(generateGroupKey())
  const first = await createGroupInvitation({
    sync: adapter,
    groupId: 'g1',
    deviceId: 'host',
    identities: [id(1)],
    groupKeyRaw: new Uint8Array(raw),
  })
  const rotated = await rotateGroupInvitation({
    sync: adapter,
    existing: first,
    groupKeyRaw: new Uint8Array(raw),
  })
  raw.fill(0)

  const oldInv = decodeInvitation(first)
  const newInv = decodeInvitation(rotated)
  expect(newInv.ticket).toBe(oldInv.ticket) // same doc
  expect(newInv.secret).not.toEqual(oldInv.secret) // fresh share secret

  // Old S against the NEW wrapped material fails (rotation invalidates prior).
  const oldFuture = unwrapGroupKeyFromShare(new Uint8Array(oldInv.secret), {
    salt: new Uint8Array(newInv.share.salt),
    iv: new Uint8Array(newInv.share.iv),
    ct: new Uint8Array(newInv.share.ct),
  })
  expect((await Effect.runPromiseExit(oldFuture))._tag).toBe('Failure')

  // New S works.
  const rawOk = await run(
    unwrapGroupKeyFromShare(new Uint8Array(newInv.secret), {
      salt: new Uint8Array(newInv.share.salt),
      iv: new Uint8Array(newInv.share.iv),
      ct: new Uint8Array(newInv.share.ct),
    }),
  )
  expect(rawOk.byteLength).toBe(32)
})

test('consentGroupJoin: joiner recovers the group from the invitation with its OWN passphrase — no host passphrase', async () => {
  const adapter = new MemoryAdapter()
  const offered = [id(1), id(2)]
  const { raw } = await run(generateGroupKey())
  const inviteStr = await createGroupInvitation({
    sync: adapter,
    groupId: 'g1',
    deviceId: 'host',
    identities: offered,
    groupKeyRaw: new Uint8Array(raw),
  })
  raw.fill(0)

  // The doc's offered records (the joiner would fetch these via the doc).
  const hostRecords = new Map<string, SyncRecord>()
  for (const ent of adapter.store.entries()) {
    if (ent[0] === HOST_KEY) continue
    hostRecords.set(ent[0], decodeRecordDoc(ent[1]))
  }

  const inv = decodeInvitation(inviteStr)
  // Joiner uses a device passphrase of ITS OWN + its passkey PRF. Crucially,
  // no host passphrase is provided anywhere.
  const jPrfSalt = crypto.getRandomValues(new Uint8Array(16))
  const consent = await run(
    consentGroupJoin({
      invitation: inv,
      hostRecords,
      deviceId: 'joiner-1',
      passphrase: 'joiner-own-passphrase',
      passkeyPrf: new Uint8Array(32).fill(7),
      passkeyPrfSalt: jPrfSalt,
      passkeyCredId: 'cred-joiner',
    }),
  )

  expect(consent.identities.map((i) => i.id)).toEqual(['id-1', 'id-2'])
  expect([...consent.records.keys()]).toEqual(['id-1', 'id-2'])
  expect(consent.envelope.groupId).toBe('g1')
  expect(consent.envelope.deviceId).toBe('joiner-1')
  expect(consent.envelope.deks.map((d) => d.method).toSorted()).toEqual([
    'passkey',
    'recovery',
  ])

  // The adopted group key lets this device read the adopted records
  // (this is what will open the vault on the joiner).
  const firstRecord = consent.records.get('id-1')!
  const read = await run(decodeIdentityRecord(consent.groupKey, firstRecord))
  expect(read.fullName).toBe('Identity 1')

  // And the joiner can unlock later with its own passphrase: unwrap K from its
  // own envelope's recovery wrap and read the same record.
  const kFromOwn = await run(
    unwrapGroupKeyLocal(
      consent.envelope,
      'recovery',
      new TextEncoder().encode('joiner-own-passphrase'),
    ),
  )
  const read2 = await run(decodeIdentityRecord(kFromOwn, firstRecord))
  expect(read2.fullName).toBe('Identity 1')
})
