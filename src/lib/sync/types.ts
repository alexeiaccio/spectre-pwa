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

/**
 * v2 group envelope (GS1): one device's wraps of the *shared group key* K,
 * under that device's own passkey + its own per-device passphrase. K is what
 * encrypts the shared identity records, so any group device can read any
 * record (periodic sync with no cross-device passphrase).
 *
 * GS6 (revocation): each device also carries an ECDH (P-256) keypair.
 * `devicePublic` (plaintext) lets other group members encrypt a *rekey*
 * payload — the new group key K′ after a rotation — to this device;
 * `deviceSecret` is that ECDH private key wrapped under THIS device's own
 * unlock, so only the device can decrypt rekeys meant for it.
 */
export interface GroupEnvelope {
  v: 2
  /** Stable id for the trust group. */
  groupId: string
  deviceId: string
  /** Each entry wraps K (not a per-device DEK). */
  deks: readonly WrappedDeK[]
  /** This device's ECDH P-256 public key (raw uncompressed point, plaintext). */
  devicePublic: ArrayBuffer
  /** This device's ECDH private key, wrapped under its own unlock. */
  deviceSecret: readonly WrappedDeK[]
}

const GroupEnvelopeDocSchema = Schema.Struct({
  v: Schema.Literal(2),
  groupId: Schema.String,
  deviceId: Schema.String,
  deks: Schema.Array(WrappedDeKSchema),
  devicePublic: Bytes,
  deviceSecret: Schema.Array(WrappedDeKSchema),
})

export const encodeGroupEnvelope = (env: GroupEnvelope): string =>
  Schema.encodeSync(Schema.fromJsonString(GroupEnvelopeDocSchema))({
    v: 2,
    groupId: env.groupId,
    deviceId: env.deviceId,
    deks: env.deks.map((d) => ({
      method: d.method,
      salt: toU8(d.salt),
      prfSalt: d.prfSalt ? toU8(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toU8(d.iv),
      wrapped: toU8(d.wrapped),
    })),
    devicePublic: toU8(env.devicePublic),
    deviceSecret: env.deviceSecret.map((d) => ({
      method: d.method,
      salt: toU8(d.salt),
      prfSalt: d.prfSalt ? toU8(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toU8(d.iv),
      wrapped: toU8(d.wrapped),
    })),
  })

export const decodeGroupEnvelope = (s: string): GroupEnvelope => {
  const w = Schema.decodeSync(Schema.fromJsonString(GroupEnvelopeDocSchema))(s)
  return {
    v: 2,
    groupId: w.groupId,
    deviceId: w.deviceId,
    deks: w.deks.map((d) => ({
      method: d.method,
      salt: toBuf(d.salt),
      prfSalt: d.prfSalt ? toBuf(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toBuf(d.iv),
      wrapped: toBuf(d.wrapped),
    })),
    devicePublic: toBuf(w.devicePublic),
    deviceSecret: w.deviceSecret.map((d) => ({
      method: d.method,
      salt: toBuf(d.salt),
      prfSalt: d.prfSalt ? toBuf(d.prfSalt) : undefined,
      credId: d.credId,
      iv: toBuf(d.iv),
      wrapped: toBuf(d.wrapped),
    })),
  }
}

/**
 * GS6 rekey record (one per remaining device, key `rekey/<deviceId>` in the
 * doc): the new group key K′ after a rotation, ECDH-encrypted to that device's
 * `devicePublic`. Only the intended device (holding `deviceSecret`) can decrypt
 * it, so a removed device that received no rekey is locked out of K′.
 */
export interface RekeyRecord {
  v: 1
  /** ECDH P-256 ephemeral public key used for this record. */
  ephPublic: ArrayBuffer
  /** AES key-wrapped K′ (GCM, iv+ct) under the derived shared secret. */
  iv: ArrayBuffer
  ct: ArrayBuffer
}

const RekeyDocSchema = Schema.Struct({
  v: Schema.Literal(1),
  ephPublic: Bytes,
  iv: Bytes,
  ct: Bytes,
})

export const encodeRekeyDoc = (r: RekeyRecord): string =>
  Schema.encodeSync(Schema.fromJsonString(RekeyDocSchema))({
    v: 1,
    ephPublic: toU8(r.ephPublic),
    iv: toU8(r.iv),
    ct: toU8(r.ct),
  })

export const decodeRekeyDoc = (s: string): RekeyRecord => {
  const w = Schema.decodeSync(Schema.fromJsonString(RekeyDocSchema))(s)
  return {
    v: 1,
    ephPublic: toBuf(w.ephPublic),
    iv: toBuf(w.iv),
    ct: toBuf(w.ct),
  }
}

/** Doc key for a device's rekey record (GS6). */
export const rekeyKey = (deviceId: string): string => `rekey/${deviceId}`
