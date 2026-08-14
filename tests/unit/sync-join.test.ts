import { expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  generateDek,
  kekFromPrf,
  wrapDek,
} from '../../src/lib/vault/crypto-dek.ts'
import type { Identity } from '../../src/lib/vault/schema.ts'
import {
  decodeIdentityRecord,
  encodeIdentityRecord,
  reencryptUnderDekB,
  unwrapRecoveryDek,
  verifyRecoveryCode,
} from '../../src/lib/sync/records.ts'
import type { DeviceEnvelope, SyncRecord } from '../../src/lib/sync/types.ts'

const textEncoder = new TextEncoder()
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

const HOST_CODE = 'correct horse battery staple'
const WRONG_CODE = 'wrong code entirely'
const DEVICE_B = 'device-b'

const IDENTITY: Identity = {
  id: 'id-1',
  fullName: 'Robert Lee Mitchell',
  algorithm: 3,
  sites: [
    {
      id: 's-1',
      name: 'twitter.com',
      counter: 1,
      template: 17,
      purpose: 'password',
    },
  ],
}

/** A host's envelope (recovery wrap) + one identity record under its DEK. */
async function makeHost(): Promise<{
  envelope: DeviceEnvelope
  record: SyncRecord
}> {
  const { key: dek, raw } = await Effect.runPromise(generateDek())
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await Effect.runPromise(
    kekFromPrf(textEncoder.encode(HOST_CODE), salt),
  )
  const wrapped = await Effect.runPromise(wrapDek(raw, kek))
  raw.fill(0)
  const envelope: DeviceEnvelope = {
    v: 1,
    deviceId: 'host-a',
    deks: [
      {
        method: 'recovery',
        salt: toBuf(salt),
        iv: toBuf(wrapped.iv),
        wrapped: toBuf(wrapped.wrapped),
      },
    ],
  }
  const record = await Effect.runPromise(
    encodeIdentityRecord(dek, IDENTITY, 'host-a'),
  )
  return { envelope, record }
}

test('verifyRecoveryCode accepts the host code and rejects a wrong one', async () => {
  const { envelope } = await makeHost()
  expect(await Effect.runPromise(verifyRecoveryCode(envelope, HOST_CODE))).toBe(
    true,
  )
  expect(
    await Effect.runPromise(verifyRecoveryCode(envelope, WRONG_CODE)),
  ).toBe(false)
})

test('reencryptUnderDekB decrypts host records and round-trips the identity', async () => {
  const { envelope, record } = await makeHost()
  const hostRecords = new Map<string, SyncRecord>([['id-1', record]])
  const joined = await Effect.runPromise(
    reencryptUnderDekB({
      hostEnvelope: envelope,
      hostRecords,
      recoveryCode: HOST_CODE,
      deviceId: DEVICE_B,
    }),
  )
  // Identities survived the decrypt → re-encrypt hop.
  expect(joined.identities).toEqual([IDENTITY])
  // B's records decrypt under DEK-B.
  const bRecord = joined.records.get('id-1')!
  const bIdentity = await Effect.runPromise(
    decodeIdentityRecord(joined.dek, bRecord),
  )
  expect(bIdentity).toEqual(IDENTITY)
  // B's envelope recovery-wrap unwraps DEK-B.
  const dekFromEnvelope = await Effect.runPromise(
    unwrapRecoveryDek(joined.envelope, HOST_CODE),
  )
  const viaEnvelope = await Effect.runPromise(
    decodeIdentityRecord(dekFromEnvelope, bRecord),
  )
  expect(viaEnvelope).toEqual(IDENTITY)
  // The host's record is untouched (still decrypts under host DEK via the code).
  const hostDek = await Effect.runPromise(
    unwrapRecoveryDek(envelope, HOST_CODE),
  )
  const hostIdentity = await Effect.runPromise(
    decodeIdentityRecord(hostDek, record),
  )
  expect(hostIdentity).toEqual(IDENTITY)
})

test('reencryptUnderDekB fails on a wrong recovery code before any re-encryption', async () => {
  const { envelope, record } = await makeHost()
  await expect(
    Effect.runPromise(
      reencryptUnderDekB({
        hostEnvelope: envelope,
        hostRecords: new Map([['id-1', record]]),
        recoveryCode: WRONG_CODE,
        deviceId: DEVICE_B,
      }),
    ),
  ).rejects.toThrow(/wrong recovery code/)
})

test('reencryptUnderDekB wraps DEK-B under the passkey PRF when provided', async () => {
  const { envelope, record } = await makeHost()
  const passkeyPrf = crypto.getRandomValues(new Uint8Array(32))
  const passkeyPrfSalt = crypto.getRandomValues(new Uint8Array(32))
  const passkeyCredId = 'abc-credential'
  const joined = await Effect.runPromise(
    reencryptUnderDekB({
      hostEnvelope: envelope,
      hostRecords: new Map([['id-1', record]]),
      recoveryCode: HOST_CODE,
      deviceId: DEVICE_B,
      passkeyPrf,
      passkeyPrfSalt,
      passkeyCredId,
    }),
  )
  expect(joined.envelope.deks.map((d) => d.method).toSorted()).toEqual([
    'passkey',
    'recovery',
  ])
  // The wrap records the PRF salt + credential id so unlock can target them.
  const passkeyWrap = joined.envelope.deks.find((d) => d.method === 'passkey')!
  expect(new Uint8Array(passkeyWrap.prfSalt!)).toEqual(passkeyPrfSalt)
  expect(passkeyWrap.credId).toBe(passkeyCredId)
  const kek = await Effect.runPromise(
    kekFromPrf(passkeyPrf, new Uint8Array(passkeyWrap.salt)),
  )
  const unwrapped = await decodeIdentityRecordByKek(
    kek,
    passkeyWrap,
    joined.records.get('id-1')!,
  )
  expect(unwrapped).toEqual(IDENTITY)
})

test('reencryptUnderDekB requires salt + credential id with a passkey PRF', async () => {
  const { envelope, record } = await makeHost()
  await expect(
    Effect.runPromise(
      reencryptUnderDekB({
        hostEnvelope: envelope,
        hostRecords: new Map([['id-1', record]]),
        recoveryCode: HOST_CODE,
        deviceId: DEVICE_B,
        passkeyPrf: crypto.getRandomValues(new Uint8Array(32)),
      }),
    ),
  ).rejects.toThrow(/salt and credential id required/)
})

// Decode a record using a KEK-derived key: import the wrapped DEK then decrypt.
async function decodeIdentityRecordByKek(
  kek: CryptoKey,
  wrap: { iv: ArrayBuffer; wrapped: ArrayBuffer },
  record: SyncRecord,
): Promise<Identity> {
  const raw = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(wrap.iv) },
    kek,
    new Uint8Array(wrap.wrapped),
  )
  const dek = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return Effect.runPromise(decodeIdentityRecord(dek, record))
}
