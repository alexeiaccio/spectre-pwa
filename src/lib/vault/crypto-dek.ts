import { Data, Effect } from 'effect'

export class CryptoError extends Data.TaggedError('CryptoError')<{
  message?: string
}> {}

const textEncoder = new TextEncoder()

/** Encode a string to an ArrayBuffer-backed Uint8Array (satisfies BufferSource). */
const ab = (s: string): Uint8Array => textEncoder.encode(s)

/** Copy a Uint8Array into a fresh ArrayBuffer so BufferSource accepts it. */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

/** An AES-GCM 256 key — used as the vault DEK and (via HKDF) as the KEK. */
export type AesKey = CryptoKey

/** Crypto domain separation constant for this app. */
const DOMAIN = 'com.spectre.pocket/v1'

/** A freshly generated DEK plus its raw 32 bytes, needed once to wrap it under KEKs. */
export interface DekAndRaw {
  key: AesKey
  raw: Uint8Array
}

/**
 * Generate a fresh random DEK (AES-GCM-256, non-extractable) plus its raw bytes.
 * The raw bytes exist only transiently at setup (used to produce each wrapped copy),
 * and should be wiped (fill with zeros) from the caller as soon as wrapping is done.
 */
export const generateDek = (): Effect.Effect<DekAndRaw, CryptoError> =>
  Effect.tryPromise(async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    // Extractable: this is the group/session key K, and the host must be able
    // to export its raw bytes to create/rotate invitations (GS3 decision).
    const key = await crypto.subtle.importKey(
      'raw',
      toBuf(raw),
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
    return { key, raw }
  }).pipe(
    Effect.mapError(() => new CryptoError({ message: 'generateKey failed' })),
  )

/**
 * Derive an AES-GCM KEK from the passkey PRF output (or recovery code bytes) via HKDF-SHA-256,
 * domain-separated under DOMAIN. Same credentials/salt → same KEK, forever.
 */
const kekFromSecret = (
  secret: Uint8Array,
  salt: Uint8Array,
): Effect.Effect<AesKey, CryptoError> =>
  Effect.tryPromise(async () => {
    const base = await crypto.subtle.importKey(
      'raw',
      toBuf(secret),
      'HKDF',
      false,
      ['deriveKey'],
    )
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: toBuf(salt),
        info: toBuf(ab(DOMAIN + '/kek')),
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }).pipe(
    Effect.mapError(
      () => new CryptoError({ message: 'HKDF deriveKey failed' }),
    ),
  )

/** HKDF of a PRF output (or recovery code bytes) — the KEK used to wrap the DEK. */
export const kekFromPrf = (
  prfOutput: Uint8Array,
  salt: Uint8Array,
): Effect.Effect<AesKey, CryptoError> => kekFromSecret(prfOutput, salt)

/**
 * Wrap the raw DEK bytes under a KEK using AES-GCM with a fresh random IV.
 * Returns {iv, wrapped}. The KEK must be a wrapping AES-GCM key derived via kekFromPrf.
 */
export const wrapDek = (
  raw: Uint8Array,
  kek: AesKey,
): Effect.Effect<{ iv: Uint8Array; wrapped: Uint8Array }, CryptoError> =>
  Effect.tryPromise(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const wrapped = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      kek,
      toBuf(raw),
    )
    return { iv, wrapped: new Uint8Array(wrapped) }
  }).pipe(Effect.mapError(() => new CryptoError({ message: 'wrapKey failed' })))

/** Unwrap a DEK from the stored {iv, wrapped} bytes under a KEK → non-extractable AES-GCM key. */
export const unwrapDek = (
  wrapped: Uint8Array,
  kek: AesKey,
  iv: Uint8Array,
): Effect.Effect<AesKey, CryptoError> =>
  Effect.tryPromise(async () => {
    const raw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      kek,
      toBuf(wrapped),
    )
    // Extractable: the vault key is the group key K, which the host exports to
    // create/rotate invitations (GS3 decision).
    return crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt'],
    )
  }).pipe(
    Effect.mapError(() => new CryptoError({ message: 'unwrapKey failed' })),
  )

/** Encrypt the plaintext vault tree, producing a random IV + ciphertext (raw bytes). */
export const encryptBlob = (
  dek: AesKey,
  plaintext: Uint8Array,
): Effect.Effect<{ iv: Uint8Array; ct: Uint8Array }, CryptoError> =>
  Effect.tryPromise(async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toBuf(iv) },
      dek,
      toBuf(plaintext),
    )
    return { iv, ct: new Uint8Array(ct) }
  }).pipe(Effect.mapError(() => new CryptoError({ message: 'encrypt failed' })))

export const decryptBlob = (
  dek: AesKey,
  iv: Uint8Array,
  ct: Uint8Array,
): Effect.Effect<Uint8Array, CryptoError> =>
  Effect.tryPromise(() =>
    crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuf(iv) }, dek, toBuf(ct)),
  ).pipe(
    Effect.map((pt) => new Uint8Array(pt)),
    Effect.mapError(
      () =>
        new CryptoError({
          message: 'decrypt failed — wrong key or corrupt blob',
        }),
    ),
  )
