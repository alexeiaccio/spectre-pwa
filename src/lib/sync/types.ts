import { Schema } from 'effect'
import type { WrappedDeK } from '../vault/schema.ts'

// Sync doc key model (S2/S3): one identity record per v1 identity uuid; one
// device envelope per device under a reserved prefix. Values in the doc are
// strings (wasm adapter base64-encodes the binary ciphertext).
export const ENVELOPE_KEY_PREFIX = 'env/'

/** Doc has no key-list API, so the creator publishes a host pointer (S5). */
export const HOST_KEY = 'host'

export interface HostPointer {
  deviceId: string
  identityIds: string[]
}

const HostDocSchema = Schema.Struct({
  deviceId: Schema.String,
  identityIds: Schema.Array(Schema.String),
})

export const encodeHostDoc = (h: HostPointer): string =>
  Schema.encodeSync(Schema.fromJsonString(HostDocSchema))(h)

export const decodeHostDoc = (s: string): HostPointer => {
  const w = Schema.decodeSync(Schema.fromJsonString(HostDocSchema))(s)
  return { deviceId: w.deviceId, identityIds: Array.from(w.identityIds) }
}

export const envelopeKey = (deviceId: string): string =>
  `${ENVELOPE_KEY_PREFIX}${deviceId}`

/** One encrypted identity record as stored in the sync doc + mirror (S2/S3/M3/M5). */
export type SyncRecord =
  | { v: 2; kind: 'record'; writer: string; iv: ArrayBuffer; ct: ArrayBuffer }
  | { v: 2; kind: 'tombstone' }

/** Wire codec: an AES-GCM {iv, ct} blob stored as base64 in the doc JSON. */
const Bytes = Schema.Uint8ArrayFromBase64
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer
const toU8 = (b: ArrayBuffer): Uint8Array => new Uint8Array(b)

const RecordBodySchema = Schema.Struct({
  v: Schema.Literal(2),
  kind: Schema.Literal('record'),
  writer: Schema.String,
  iv: Bytes,
  ct: Bytes,
})

const TombstoneSchema = Schema.Struct({
  v: Schema.Literal(2),
  kind: Schema.Literal('tombstone'),
})

export const encodeRecordDoc = (record: SyncRecord): string => {
  if (record.kind === 'tombstone') {
    return Schema.encodeSync(Schema.fromJsonString(TombstoneSchema))({
      v: 2,
      kind: 'tombstone',
    })
  }
  return Schema.encodeSync(Schema.fromJsonString(RecordBodySchema))({
    v: 2,
    kind: 'record',
    writer: record.writer,
    iv: toU8(record.iv),
    ct: toU8(record.ct),
  })
}

export const decodeRecordDoc = (s: string): SyncRecord => {
  const w = JSON.parse(s) as Record<string, unknown>
  if (w.v === 2 && w.kind === 'tombstone') return { v: 2, kind: 'tombstone' }
  if (w.v === 2 && w.kind === 'record') {
    return {
      v: 2,
      kind: 'record',
      writer: String(w.writer),
      iv: toBuf(Schema.decodeSync(Bytes)(w.iv as string)),
      ct: toBuf(Schema.decodeSync(Bytes)(w.ct as string)),
    }
  }
  if (w.v === 1) {
    return {
      v: 2,
      kind: 'record',
      writer: '',
      iv: toBuf(Schema.decodeSync(Bytes)(w.iv as string)),
      ct: toBuf(Schema.decodeSync(Bytes)(w.ct as string)),
    }
  }
  throw new Error('unknown record format')
}

/** A device's non-secret envelope: its DEK wrapped under code + (after enroll) passkey. */
export interface DeviceEnvelope {
  v: 1
  deviceId: string
  deks: readonly WrappedDeK[]
}

const WrappedDeKSchema = Schema.Struct({
  method: Schema.Union([Schema.Literal('passkey'), Schema.Literal('recovery')]),
  salt: Bytes,
  prfSalt: Schema.optional(Bytes),
  credId: Schema.optional(Schema.String),
  iv: Bytes,
  wrapped: Bytes,
})

const EnvelopeDocSchema = Schema.Struct({
  v: Schema.Literal(1),
  deviceId: Schema.String,
  deks: Schema.Array(WrappedDeKSchema),
})

export const encodeEnvelopeDoc = (env: DeviceEnvelope): string =>
  Schema.encodeSync(Schema.fromJsonString(EnvelopeDocSchema))({
    v: 1,
    deviceId: env.deviceId,
    deks: env.deks.map((d) => ({
      method: d.method,
      salt: toU8(d.salt),
      prfSalt: d.prfSalt ? toU8(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toU8(d.iv),
      wrapped: toU8(d.wrapped),
    })),
  })

export const decodeEnvelopeDoc = (s: string): DeviceEnvelope => {
  const w = Schema.decodeSync(Schema.fromJsonString(EnvelopeDocSchema))(s)
  return {
    v: 1,
    deviceId: w.deviceId,
    deks: w.deks.map((d) => ({
      method: d.method,
      salt: toBuf(d.salt),
      prfSalt: d.prfSalt ? toBuf(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toBuf(d.iv),
      wrapped: toBuf(d.wrapped),
    })),
  }
}
