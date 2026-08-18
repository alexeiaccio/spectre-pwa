import { Effect } from 'effect'
import {
  CryptoError,
  generateDek,
  kekFromPrf,
  unwrapDek,
  wrapDek,
  type AesKey,
} from '../vault/crypto-dek.ts'
import type { WrappedDeK } from '../vault/schema.ts'
import type { GroupEnvelope } from './types.ts'

// GS1: the shared group key model. One group key K encrypts all shared
// identity records; every trusted device holds K wrapped under ITS OWN
// passkey + per-device passphrase (GroupEnvelope). A one-time share secret
// S (carried by an invitation) is the trust handoff that lets a joiner
// recover K once — the host rotates S afterward so the invitation is
// single-use.

const textEncoder = new TextEncoder()
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer
const KEK_SALT_BYTES = 16

export type GroupKey = AesKey

/** Import raw group-key bytes (32) as a non-extractable AES-GCM key. */
export const importGroupKey = (raw: Uint8Array): Effect.Effect<GroupKey, CryptoError> =>
  Effect.tryPromise(async () => {
    if (raw.byteLength !== 32)
      throw new Error('group key must be 32 bytes')
    return crypto.subtle.importKey(
      'raw',
      toBuf(raw),
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }).pipe(
    Effect.mapError(() => new CryptoError({ message: 'importGroupKey failed' })),
  )

/** Generate a fresh random group key plus its raw 32 bytes (wipe after wrapping). */
export const generateGroupKey = (): Effect.Effect<
  { key: GroupKey; raw: Uint8Array },
  CryptoError
> => generateDek()

/**
 * Wrap the raw group-key bytes under this device's local unlock: a per-device
 * passphrase (recovery method, always) and, if given, the passkey PRF output
 * (passkey method). Raw bytes are wiped once wrapped.
 */
export const wrapGroupKeyUnder = Effect.fn('group-sync.wrapGroupKeyUnder')(
  function* (args: {
    raw: Uint8Array
    passphrase: string
    passkeyPrf?: Uint8Array
    passkeyPrfSalt?: Uint8Array
    passkeyCredId?: string
  }): Effect.fn.Return<WrappedDeK[], CryptoError> {
    const deks: WrappedDeK[] = []
    const saltR = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
    const kekR = yield* kekFromPrf(textEncoder.encode(args.passphrase), saltR)
    const wrappedR = yield* wrapDek(args.raw, kekR)
    deks.push({
      method: 'recovery',
      salt: toBuf(saltR),
      iv: toBuf(wrappedR.iv),
      wrapped: toBuf(wrappedR.wrapped),
    })
    if (args.passkeyPrf) {
      if (!args.passkeyPrfSalt || !args.passkeyCredId)
        return yield* new CryptoError({
          message: 'passkey PRF salt and credential id required',
        })
      const saltP = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
      const kekP = yield* kekFromPrf(args.passkeyPrf, saltP)
      const wrappedP = yield* wrapDek(args.raw, kekP)
      deks.push({
        method: 'passkey',
        salt: toBuf(saltP),
        prfSalt: toBuf(args.passkeyPrfSalt),
        credId: args.passkeyCredId,
        iv: toBuf(wrappedP.iv),
        wrapped: toBuf(wrappedP.wrapped),
      })
    }
    args.raw.fill(0)
    return deks
  },
)

/**
 * Unwrap K locally from a device's group envelope, using either its per-device
 * passphrase (`kind: 'recovery'`, `secret` = utf8 passphrase bytes) or its
 * passkey PRF output (`kind: 'passkey'`, `secret` = prf bytes).
 */
export const unwrapGroupKeyLocal = Effect.fn(
  'group-sync.unwrapGroupKeyLocal',
)(
  function* (env: GroupEnvelope, kind: 'recovery' | 'passkey', secret: Uint8Array): Effect.fn.Return<
    GroupKey,
    CryptoError
  > {
    const rec = env.deks.find((d) => d.method === kind)
    if (!rec)
      return yield* new CryptoError({
        message: `group envelope has no ${kind} wrap`,
      })
    const kek = yield* kekFromPrf(secret, new Uint8Array(rec.salt))
    return yield* unwrapDek(
      new Uint8Array(rec.wrapped),
      kek,
      new Uint8Array(rec.iv),
    )
  },
  Effect.mapError(() => new CryptoError({ message: 'wrong unlock secret' })),
)

/** A fresh, one-time invitation share secret S (32 random bytes). */
export const createShareSecret = (): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(32))

/**
 * Wrap K under the share secret S (an invitation-scoped KEK). Returns the
 * salt/iv/ciphertext so the joiner can unwrap with the same S. This is the
 * invitation handoff material (GS2).
 */
export const wrapGroupKeyUnderShare = (
  raw: Uint8Array,
  shareSecret: Uint8Array,
): Effect.Effect<
  { salt: Uint8Array; iv: Uint8Array; ct: Uint8Array },
  CryptoError
> =>
  Effect.gen(function* () {
    const salt = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
    const kek = yield* kekFromPrf(shareSecret, salt)
    const wrapped = yield* wrapDek(raw, kek)
    return { salt, iv: wrapped.iv, ct: wrapped.wrapped }
  })

/** Recover K from the invitation share material (GS2). Wrong S fails. */
export const unwrapGroupKeyFromShare = (
  shareSecret: Uint8Array,
  material: { salt: Uint8Array; iv: Uint8Array; ct: Uint8Array },
): Effect.Effect<GroupKey, CryptoError> =>
  Effect.gen(function* () {
    const kek = yield* kekFromPrf(shareSecret, material.salt)
    return yield* unwrapDek(material.ct, kek, material.iv)
  })
