import { expect, test } from 'vitest'
import {
  decodeEnvelopeDoc,
  decodeHostDoc,
  decodeRecordDoc,
  encodeEnvelopeDoc,
  encodeHostDoc,
  encodeRecordDoc,
  type DeviceEnvelope,
  type HostPointer,
  type SyncRecord,
} from '../../src/lib/sync/types.ts'

const bytes = (n: number): ArrayBuffer =>
  crypto.getRandomValues(new Uint8Array(n)).buffer as ArrayBuffer

const toB64 = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b)))

test('host doc round-trips through the JSON wire format', () => {
  const h: HostPointer = { deviceId: 'd1', identityIds: ['a', 'b'] }
  expect(decodeHostDoc(encodeHostDoc(h))).toEqual(h)
})

test('record doc round-trips the ciphertext bytes', () => {
  const rec: SyncRecord = {
    v: 2,
    kind: 'record',
    writer: 'dev-1',
    iv: bytes(12),
    ct: bytes(16),
  }
  expect(decodeRecordDoc(encodeRecordDoc(rec))).toEqual(rec)
})

test('tombstone doc round-trips', () => {
  const tomb: SyncRecord = { v: 2, kind: 'tombstone' }
  expect(decodeRecordDoc(encodeRecordDoc(tomb))).toEqual(tomb)
})

test('v1 legacy record doc decodes as a live record with an unknown writer', () => {
  const iv = bytes(12)
  const ct = bytes(16)
  const v1 = JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(ct) })
  const back = asRecord(decodeRecordDoc(v1))
  expect(back.writer).toBe('')
  expect(back.iv).toEqual(iv)
  expect(back.ct).toEqual(ct)
})

const asRecord = (r: SyncRecord): Extract<SyncRecord, { kind: 'record' }> => {
  if (r.kind !== 'record') throw new Error('expected a live record')
  return r
}

test('envelope doc round-trips recovery + passkey wraps incl prfSalt/credId', () => {
  const env: DeviceEnvelope = {
    v: 1,
    deviceId: 'd2',
    deks: [
      {
        method: 'recovery',
        salt: bytes(16),
        iv: bytes(12),
        wrapped: bytes(32),
      },
      {
        method: 'passkey',
        salt: bytes(16),
        prfSalt: bytes(16),
        credId: 'cred-x',
        iv: bytes(12),
        wrapped: bytes(32),
      },
    ],
  }
  expect(decodeEnvelopeDoc(encodeEnvelopeDoc(env))).toEqual(env)
})

test('wire decode validates structure instead of trusting the doc', () => {
  // Missing required fields
  expect(() => decodeHostDoc('{"deviceId":"d"}')).toThrow(/identityIds/)
  // Wrong element type inside an array
  expect(() => decodeHostDoc('{"deviceId":"d","identityIds":[1]}')).toThrow(
    /string/,
  )
  // Wrong record version literal
  expect(() =>
    decodeRecordDoc(
      '{"v":3,"kind":"record","writer":"w","iv":"AA==","ct":"AA=="}',
    ),
  ).toThrow(/unknown record format/)
  // Invalid base64 in a byte field
  expect(() =>
    decodeRecordDoc(
      '{"v":2,"kind":"record","writer":"w","iv":"!!!","ct":"AA=="}',
    ),
  ).toThrow(/base64|Expected/)
  // Bad deks method literal
  expect(() =>
    decodeEnvelopeDoc(
      '{"v":1,"deviceId":"d","deks":[{"method":"password","salt":"AA==","iv":"AA==","wrapped":"AA=="}]}',
    ),
  ).toThrow(/passkey|recovery/)
  // Malformed JSON
  expect(() => decodeHostDoc('not json')).toThrow(/JSON/)
})
