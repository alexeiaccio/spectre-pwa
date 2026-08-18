import { expect, test } from 'vitest'
import { Effect } from 'effect'
import type { SyncAdapter } from '../../src/lib/sync/adapter.ts'
import {
  createGroupInvitation,
  decodeInvitation,
  encodeInvitation,
  rotateGroupInvitation,
} from '../../src/lib/sync/invitation.ts'
import { generateGroupKey, unwrapGroupKeyFromShare } from '../../src/lib/sync/group.ts'
import { decodeIdentityRecord } from '../../src/lib/sync/records.ts'
import { HOST_KEY, decodeHostDoc, decodeRecordDoc } from '../../src/lib/sync/types.ts'
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
  const k = await run(
    unwrapGroupKeyFromShare(new Uint8Array(inv.secret), {
      salt: new Uint8Array(inv.share.salt),
      iv: new Uint8Array(inv.share.iv),
      ct: new Uint8Array(inv.share.ct),
    }),
  )
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
  const ok = await run(
    unwrapGroupKeyFromShare(new Uint8Array(newInv.secret), {
      salt: new Uint8Array(newInv.share.salt),
      iv: new Uint8Array(newInv.share.iv),
      ct: new Uint8Array(newInv.share.ct),
    }),
  )
  expect(ok.usages?.includes('encrypt')).toBe(true)
})
