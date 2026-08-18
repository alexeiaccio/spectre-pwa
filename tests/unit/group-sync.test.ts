import { expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  decodeGroupEnvelope,
  encodeGroupEnvelope,
  type GroupEnvelope,
} from '../../src/lib/sync/types.ts'
import {
  createShareSecret,
  generateGroupKey,
  importGroupKey,
  unwrapGroupKeyFromShare,
  unwrapGroupKeyLocal,
  wrapGroupKeyUnder,
  wrapGroupKeyUnderShare,
} from '../../src/lib/sync/group.ts'
import {
  decodeIdentityRecord,
  encodeIdentityRecord,
} from '../../src/lib/sync/records.ts'
import type { Identity } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)
const textEncoder = new TextEncoder()

const sampleIdentity: Identity = {
  id: 'id-1',
  fullName: 'Ada Lovelace',
  algorithm: 3,
  sites: [{ id: 's1', name: 'example.com', counter: 1, template: 1, purpose: 'password' }],
}

test('group envelope round-trips through the JSON wire format (v2)', () => {
  const env: GroupEnvelope = {
    v: 2,
    groupId: 'g1',
    deviceId: 'dev-a',
    deks: [
      {
        method: 'recovery',
        salt: new Uint8Array(16).buffer as ArrayBuffer,
        iv: new Uint8Array(12).buffer as ArrayBuffer,
        wrapped: new Uint8Array(32).buffer as ArrayBuffer,
      },
    ],
    // GS6: device ECDH keypair wired into the envelope.
    devicePublic: new Uint8Array(65).buffer as ArrayBuffer,
    deviceSecret: [
      {
        method: 'recovery',
        salt: new Uint8Array(16).buffer as ArrayBuffer,
        iv: new Uint8Array(12).buffer as ArrayBuffer,
        wrapped: new Uint8Array(32).buffer as ArrayBuffer,
      },
    ],
  }
  const decoded = decodeGroupEnvelope(encodeGroupEnvelope(env))
  expect(decoded.v).toBe(2)
  expect(decoded.groupId).toBe('g1')
  expect(decoded.deviceId).toBe('dev-a')
  expect(decoded.deks).toHaveLength(1)
  expect(decoded.deks[0].method).toBe('recovery')
  expect(decoded.devicePublic).toEqual(env.devicePublic)
  expect(decoded.deviceSecret).toHaveLength(1)
})

test('devices with independent local unlocks unwrap the SAME group key and read each other\'s records', async () => {
  // Host A generates the group key K.
  const { key: ka, raw } = await run(generateGroupKey())

  // A wraps K under its own passphrase + passkey PRF; B wraps the same K under
  // only its own passphrase. Two independent local unlocks, no shared code.
  const aPrf = new Uint8Array(32)
  // Fixed PRF bytes; use a real-ish 16-byte salt + cred id.
  const aPrfSalt = crypto.getRandomValues(new Uint8Array(16))
  const aDeks = await run(
    wrapGroupKeyUnder({
      raw: new Uint8Array(raw),
      passphrase: 'device-a-passphrase',
      passkeyPrf: aPrf,
      passkeyPrfSalt: aPrfSalt,
      passkeyCredId: 'cred-a',
    }),
  )
  const bDeks = await run(
    wrapGroupKeyUnder({
      raw: new Uint8Array(raw),
      passphrase: 'device-b-passphrase',
    }),
  )
  raw.fill(0) // wipe after wrapping

  const envA: GroupEnvelope = { v: 2, groupId: 'g1', deviceId: 'dev-a', deks: aDeks }
  const envB: GroupEnvelope = { v: 2, groupId: 'g1', deviceId: 'dev-b', deks: bDeks }

  // Each device unwraps K using ITS OWN secret — no exchange of the other's.
  const kA = await run(
    unwrapGroupKeyLocal(envA, 'passkey', aPrf),
  )
  const kB = await run(
    unwrapGroupKeyLocal(envB, 'recovery', textEncoder.encode('device-b-passphrase')),
  )

  // A writes a record under K; B (holding the same K) can read it — the
  // periodic-sync precondition, with zero cross-device passphrase.
  const rec = await run(encodeIdentityRecord(kA, sampleIdentity, 'dev-a'))
  const read = await run(decodeIdentityRecord(kB, rec))
  expect(read).toEqual(sampleIdentity)

  // B's passkey unlock also works for B if it had a passkey wrap; and A's
  // passphrase unlock works for A.
  const kA2 = await run(
    unwrapGroupKeyLocal(envA, 'recovery', textEncoder.encode('device-a-passphrase')),
  )
  const read2 = await run(decodeIdentityRecord(kA2, rec))
  expect(read2.fullName).toBe('Ada Lovelace')
})

test('a wrong local secret fails to unwrap the group key', async () => {
  const { raw } = await run(generateGroupKey())
  const deks = await run(
    wrapGroupKeyUnder({
      raw: new Uint8Array(raw),
      passphrase: 'correct-phrase',
    }),
  )
  raw.fill(0)
  const env: GroupEnvelope = { v: 2, groupId: 'g1', deviceId: 'dev', deks }
  const bad = await Effect.runPromiseExit(
    unwrapGroupKeyLocal(env, 'recovery', textEncoder.encode('wrong-phrase')),
  )
  expect(bad._tag).toBe('Failure')
})

test('share secret: recover K with the invitation secret; wrong S fails; rotation invalidates the old S', async () => {
  const { key: k, raw } = await run(generateGroupKey())
  const s1 = createShareSecret()
  const s2 = createShareSecret() // the rotated invitation secret

  const mat1 = await run(wrapGroupKeyUnderShare(new Uint8Array(raw), s1))
  const rawFromS1 = await run(
    unwrapGroupKeyFromShare(s1, {
      salt: mat1.salt,
      iv: mat1.iv,
      ct: mat1.ct,
    }),
  )
  const kFromS1 = await run(importGroupKey(rawFromS1))
  raw.fill(0)

  // The invitation material lets the joiner recover K.
  const rec = await run(encodeIdentityRecord(kFromS1, sampleIdentity, 'host'))
  const read = await run(
    decodeIdentityRecord(k, rec), // host-side K validates
  )
  expect(read.fullName).toBe('Ada Lovelace')

  // Wrong secret can't open it.
  const bad = await Effect.runPromiseExit(
    unwrapGroupKeyFromShare(createShareSecret(), {
      salt: mat1.salt,
      iv: mat1.iv,
      ct: mat1.ct,
    }),
  )
  expect(bad._tag).toBe('Failure')

  // Rotation: host rewraps K under a fresh S2; the old S1 must no longer unlock.
  const mat2 = await run(wrapGroupKeyUnderShare(new Uint8Array(raw), s2))
  const rawFromS2 = await run(
    unwrapGroupKeyFromShare(s2, { salt: mat2.salt, iv: mat2.iv, ct: mat2.ct }),
  )
  const kFromS2 = await run(importGroupKey(rawFromS2))
  const kFromOldS = await Effect.runPromiseExit(
    unwrapGroupKeyFromShare(s1, { salt: mat2.salt, iv: mat2.iv, ct: mat2.ct }),
  )
  expect(kFromOldS._tag).toBe('Failure')
  void kFromS2
})
