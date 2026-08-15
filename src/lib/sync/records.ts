import { Effect, Schema } from 'effect'
import {
  CryptoError,
  decryptBlob,
  encryptBlob,
  generateDek,
  kekFromPrf,
  unwrapDek,
  wrapDek,
  type AesKey,
} from '../vault/crypto-dek.ts'
import { IdentitySchema } from '../vault/schema.ts'
import type { Identity, Vault, WrappedDeK } from '../vault/schema.ts'
import type { DeviceEnvelope, SyncRecord } from './types.ts'

const textEncoder = new TextEncoder()
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer
const KEK_SALT_BYTES = 16

/**
 * Unwrap a device's DEK from its envelope using the vault-wide recovery code.
 * Fails with a distinct error when the code is wrong (S3: the code must unwrap
 * ANY device's DEK; that's how a joining device verifies the code against the
 * host's real data before any re-encryption).
 */
export const unwrapRecoveryDek = Effect.fn('sync.unwrapRecoveryDek')(
  function* (
    envelope: DeviceEnvelope,
    code: string,
  ): Effect.fn.Return<AesKey, CryptoError> {
    const rec = envelope.deks.find((d) => d.method === 'recovery')
    if (!rec)
      return yield* new CryptoError({
        message: 'host envelope has no recovery record',
      })
    const kek = yield* kekFromPrf(
      textEncoder.encode(code),
      new Uint8Array(rec.salt),
    )
    return yield* unwrapDek(
      new Uint8Array(rec.wrapped),
      kek,
      new Uint8Array(rec.iv),
    )
  },
  Effect.mapError(() => new CryptoError({ message: 'wrong recovery code' })),
)

/** True iff the recovery code unwraps the host envelope's DEK. */
export const verifyRecoveryCode = (
  envelope: DeviceEnvelope,
  code: string,
): Effect.Effect<boolean, CryptoError> =>
  unwrapRecoveryDek(envelope, code).pipe(
    Effect.matchEffect({
      onSuccess: () => Effect.succeed(true),
      onFailure: () => Effect.succeed(false),
    }),
  )

/** Encrypt one identity under a DEK → a live doc record (S2 ciphertext, writer = device). */
export const encodeIdentityRecord = (
  dek: AesKey,
  identity: Identity,
  writer: string,
): Effect.Effect<SyncRecord, CryptoError> =>
  encryptBlob(dek, textEncoder.encode(JSON.stringify(identity))).pipe(
    Effect.map(({ iv, ct }) => ({
      v: 2,
      kind: 'record',
      writer,
      iv: toBuf(iv),
      ct: toBuf(ct),
    })),
  )

/** Decrypt a live doc record back to an identity (S3 read path). Tombstones have no ciphertext. */
export const decodeIdentityRecord = (
  dek: AesKey,
  record: SyncRecord,
): Effect.Effect<Identity, CryptoError> =>
  Effect.gen(function* () {
    if (record.kind !== 'record')
      return yield* new CryptoError({ message: 'record is a tombstone' })
    const pt = yield* decryptBlob(
      dek,
      new Uint8Array(record.iv),
      new Uint8Array(record.ct),
    )
    return Schema.decodeSync(Schema.fromJsonString(IdentitySchema))(
      new TextDecoder().decode(pt),
    )
  })

/**
 * Wrap raw DEK bytes under the recovery code (always) and, if provided, the
 * passkey PRF output. Wipes the raw bytes once wrapped. Mirrors v1's envelope
 * wrap (same kekFromPrf domain separation → cross-device compatible). The PRF
 * salt that produced `passkeyPrf` is recorded so unlock can re-derive it.
 */
const wrapDekUnder = Effect.fn('sync.wrapDekUnder')(function* (
  raw: Uint8Array,
  recoveryCode: string,
  passkeyPrf?: Uint8Array,
  passkeyPrfSalt?: Uint8Array,
  passkeyCredId?: string,
): Effect.fn.Return<WrappedDeK[], CryptoError> {
  const deks: WrappedDeK[] = []
  const saltR = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
  const kekR = yield* kekFromPrf(textEncoder.encode(recoveryCode), saltR)
  const wrappedR = yield* wrapDek(raw, kekR)
  deks.push({
    method: 'recovery',
    salt: toBuf(saltR),
    iv: toBuf(wrappedR.iv),
    wrapped: toBuf(wrappedR.wrapped),
  })
  if (passkeyPrf) {
    if (!passkeyPrfSalt || !passkeyCredId)
      return yield* new CryptoError({
        message: 'passkey PRF salt and credential id required',
      })
    const saltP = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
    const kekP = yield* kekFromPrf(passkeyPrf, saltP)
    const wrappedP = yield* wrapDek(raw, kekP)
    deks.push({
      method: 'passkey',
      salt: toBuf(saltP),
      prfSalt: toBuf(passkeyPrfSalt),
      credId: passkeyCredId,
      iv: toBuf(wrappedP.iv),
      wrapped: toBuf(wrappedP.wrapped),
    })
  }
  raw.fill(0)
  return deks
})

export interface JoinedDoc {
  /** Identity records re-encrypted under the joining device's DEK (S5: re-encrypt on join). */
  records: Map<string, SyncRecord>
  /** The joining device's envelope (recovery wrap, plus passkey wrap if enrolled). */
  envelope: DeviceEnvelope
  /** The joining device's DEK — used to complete the local (mirror) unlock. */
  dek: AesKey
  /** The identities in plaintext, for the local vault after joining. */
  identities: Identity[]
}

/**
 * Device B joins A's sync doc (S5 fresh-join): verify the recovery code against
 * A's envelope, decrypt A's records under A's DEK, and re-encrypt them under a
 * fresh DEK-B wrapped under the code (and B's passkey PRF, if provided). No
 * plaintext DEK or record is shipped; the code is verified against real data
 * before any re-encryption.
 */
export const reencryptUnderDekB = Effect.fn('sync.reencryptUnderDekB')(
  function* (args: {
    hostEnvelope: DeviceEnvelope
    hostRecords: ReadonlyMap<string, SyncRecord>
    recoveryCode: string
    deviceId: string
    passkeyPrf?: Uint8Array
    /** The PRF-eval salt that produced `passkeyPrf` (recorded on B's passkey wrap). */
    passkeyPrfSalt?: Uint8Array
    /** B's resident credential id (base64url) — targets the right credential at unlock. */
    passkeyCredId?: string
  }): Effect.fn.Return<JoinedDoc, CryptoError> {
    const hostDek = yield* unwrapRecoveryDek(
      args.hostEnvelope,
      args.recoveryCode,
    )
    const { key: dekB, raw } = yield* generateDek()
    const deks = yield* wrapDekUnder(
      raw,
      args.recoveryCode,
      args.passkeyPrf,
      args.passkeyPrfSalt,
      args.passkeyCredId,
    )
    const records = new Map<string, SyncRecord>()
    const identities: Identity[] = []
    for (const [id, record] of args.hostRecords) {
      const identity = yield* decodeIdentityRecord(hostDek, record)
      const reenc = yield* encodeIdentityRecord(dekB, identity, args.deviceId)
      records.set(id, reenc)
      identities.push(identity)
    }
    return {
      records,
      envelope: { v: 1, deviceId: args.deviceId, deks },
      dek: dekB,
      identities,
    }
  },
)

/**
 * Existing-vault join (S5: "adopts the host's code"). B keeps its identities but
 * adopts A's recovery code: since B's DEK is non-extractable, adoption is a
 * **rotation** — a fresh DEK-B′ is wrapped under A's code (+ B's existing
 * passkey PRF), and the merged identity set (B's local identities win on uuid
 * conflict; A's non-conflicting records are adopted) is re-encrypted under it.
 * The result is written to A's doc and to B's mirror; B's old code stops working.
 */
export const adoptHostCode = Effect.fn('sync.adoptHostCode')(function* (args: {
  hostEnvelope: DeviceEnvelope
  hostRecords: ReadonlyMap<string, SyncRecord>
  hostCode: string
  localVault: Vault
  deviceId: string
  passkeyPrf?: Uint8Array
  passkeyPrfSalt?: Uint8Array
  passkeyCredId?: string
}): Effect.fn.Return<JoinedDoc, CryptoError> {
  const hostDek = yield* unwrapRecoveryDek(args.hostEnvelope, args.hostCode)
  const { key: dekB2, raw } = yield* generateDek()
  const deks = yield* wrapDekUnder(
    raw,
    args.hostCode,
    args.passkeyPrf,
    args.passkeyPrfSalt,
    args.passkeyCredId,
  )
  const merged = new Map<string, Identity>(
    args.localVault.identities.map((i) => [i.id, i]),
  )
  for (const [id, record] of args.hostRecords) {
    if (record.kind !== 'record' || merged.has(id)) continue
    const identity = yield* decodeIdentityRecord(hostDek, record)
    merged.set(id, identity)
  }
  const identities = [...merged.values()]
  const records = new Map<string, SyncRecord>()
  for (const identity of identities) {
    const rec = yield* encodeIdentityRecord(dekB2, identity, args.deviceId)
    records.set(identity.id, rec)
  }
  return {
    records,
    envelope: { v: 1, deviceId: args.deviceId, deks },
    dek: dekB2,
    identities,
  }
})
