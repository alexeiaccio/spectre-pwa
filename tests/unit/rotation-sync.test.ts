import { expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  decryptRekey,
  generateDeviceKeypair,
  importGroupKey,
  wrapGroupKeyUnder,
} from '../../src/lib/sync/group.ts'
import { consumeRekey, rotateGroupKey } from '../../src/lib/sync/rotation.ts'
import { decodeIdentityRecord } from '../../src/lib/sync/records.ts'
import type { GroupEnvelope } from '../../src/lib/sync/types.ts'
import type { Identity } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const identityA: Identity = {
  id: 'id-a',
  fullName: 'Alice',
  algorithm: 3,
  sites: [],
}

/** Build a device's group envelope wrapping K under a passphrase (+ device ECDH key). */
async function makeEnvelope(
  k: Uint8Array,
  deviceId: string,
  passphrase: string,
): Promise<{ env: GroupEnvelope; privatePkcs8: Uint8Array }> {
  const device = await run(generateDeviceKeypair())
  const deks = await run(wrapGroupKeyUnder({ raw: new Uint8Array(k), passphrase }))
  const deviceSecret = await run(
    wrapGroupKeyUnder({ raw: new Uint8Array(device.privatePkcs8), passphrase }),
  )
  return {
    env: {
      v: 2,
      groupId: 'g',
      deviceId,
      deks,
      devicePublic: device.publicRaw.slice().buffer,
      deviceSecret,
    },
    privatePkcs8: device.privatePkcs8,
  }
}

const groupOf = (
  entries: Array<{ env: GroupEnvelope }>,
): Map<string, GroupEnvelope> =>
  new Map(entries.map(({ env }) => [env.deviceId, env]))

test('rotation re-encrypts records under K′ and rekeys only remaining devices', async () => {
  const k = crypto.getRandomValues(new Uint8Array(32))
  const host = await makeEnvelope(k, 'host', 'host-pass')
  const alice = await makeEnvelope(k, 'alice', 'alice-pass')
  const bob = await makeEnvelope(k, 'bob', 'bob-pass')

  // Host removes BOB.
  const result = await run(
    rotateGroupKey({
      identities: [identityA],
      deviceId: 'host',
      passphrase: 'host-pass',
      removedDeviceIds: new Set(['bob']),
      remainingEnvelopes: groupOf([host, alice, bob]),
    }),
  )

  // Alice is rekeyed; Bob is not.
  const rekeyForAlice = result.rekeys.get('alice')
  expect(rekeyForAlice).toBeDefined()
  expect(result.rekeys.has('bob')).toBe(false)
  expect(result.rekeys.has('host')).toBe(false) // host rewraps itself

  // Alice consumes her rekey → K′ → reads a re-encrypted record.
  const { groupKeyPrimeRaw } = await run(
    consumeRekey({
      rekey: rekeyForAlice!,
      myEnvelope: alice.env,
      passphrase: 'alice-pass',
    }),
  )
  const kprime = await run(importGroupKey(new Uint8Array(groupKeyPrimeRaw)))
  const record = result.records.get('id-a')!
  const read = await run(decodeIdentityRecord(kprime, record))
  expect(read.fullName).toBe('Alice')

  // Host uses the same K′ (its envelope wraps it).
  const hostKprime = await run(importGroupKey(new Uint8Array(result.groupKeyPrimeRaw)))
  const hostRead = await run(decodeIdentityRecord(hostKprime, record))
  expect(hostRead.fullName).toBe('Alice')
})

test('a removed device cannot decrypt a remaining device\'s rekey', async () => {
  const k = crypto.getRandomValues(new Uint8Array(32))
  const host = await makeEnvelope(k, 'host', 'host-pass')
  const alice = await makeEnvelope(k, 'alice', 'alice-pass')
  const bob = await makeEnvelope(k, 'bob', 'bob-pass')

  const result = await run(
    rotateGroupKey({
      identities: [identityA],
      deviceId: 'host',
      passphrase: 'host-pass',
      removedDeviceIds: new Set(['bob']),
      remainingEnvelopes: groupOf([host, alice, bob]),
    }),
  )
  const rekeyForAlice = result.rekeys.get('alice')!
  expect(rekeyForAlice).toBeDefined()

  // Bob (holding only its own deviceSecret) tries to read Alice's rekey.
  const bad = await Effect.runPromiseExit(
    decryptRekey(new Uint8Array(bob.privatePkcs8), {
      ephPublic: new Uint8Array(rekeyForAlice.ephPublic),
      iv: new Uint8Array(rekeyForAlice.iv),
      ct: new Uint8Array(rekeyForAlice.ct),
    }),
  )
  expect(bad._tag).toBe('Failure')
})

test('a removed device holding the OLD key cannot read post-rotation records', async () => {
  const k = crypto.getRandomValues(new Uint8Array(32))
  const host = await makeEnvelope(k, 'host', 'host-pass')
  const alice = await makeEnvelope(k, 'alice', 'alice-pass')
  const bob = await makeEnvelope(k, 'bob', 'bob-pass')

  const result = await run(
    rotateGroupKey({
      identities: [identityA],
      deviceId: 'host',
      passphrase: 'host-pass',
      removedDeviceIds: new Set(['bob']),
      remainingEnvelopes: groupOf([host, alice, bob]),
    }),
  )
  const record = result.records.get('id-a')!
  const oldReader = await run(importGroupKey(new Uint8Array(k)))
  const outcome = await Effect.runPromiseExit(
    decodeIdentityRecord(oldReader, record),
  )
  expect(outcome._tag).toBe('Failure') // old K can't decrypt records under K′
})
