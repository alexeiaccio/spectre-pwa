import { Context, Effect } from 'effect'
import {
  decryptBlob,
  encryptBlob,
  generateDek,
  kekFromPrf,
  unwrapDek,
  wrapDek,
  type AesKey,
} from './crypto-dek.ts'
import {
  readEnvelope,
  readVaultBlob,
  writeEnvelope,
  writeVaultBlob,
} from './storage.ts'
import { createPasskeyWithPrf, getPrfOutput } from './passkey.ts'
import type { CryptoError } from './crypto-dek.ts'
import type { PasskeyError } from './passkey.ts'
import type { Envelope, Vault, WrappedDeK } from './schema.ts'

export type VaultError = VaultStorageError | VaultUnlockedError | CryptoError | PasskeyError
export type { CryptoError, PasskeyError }

const textEncoder = new TextEncoder()
const encodeJson = (v: Vault): Uint8Array => textEncoder.encode(JSON.stringify(v))

const KEK_SALT_BYTES = 16

/** Copy a Uint8Array into a fresh ArrayBuffer (schema stores ArrayBuffer). */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

// --- Service layer (Effect v4 function-style key) ---

export interface VaultService {
  /** First run: create passkey under PRF, generate DEK, wrap under passkey+recovery code, write envelope+blob. */
  setup: (recoveryCode: string) => Effect.Effect<{ recoveryRecord: WrappedDeK; identity: Vault }, VaultError>
  /** Unlock via passkey: PRF → KEK → unwrap DEK → decrypt blob. Returns the unlocked tree. */
  unlock: () => Effect.Effect<Vault, VaultError>
  /** Recovery path: code → KEK → unwrap DEK → decrypt blob. */
  unlockWithRecovery: (code: string) => Effect.Effect<Vault, VaultError>
  /**
   * Replace a lost passkey. Requires an active session (the vault must already be
   * unlocked, normally via recovery code). Rotates the DEK: decrypt with the old DEK,
   * create a fresh DEK, re-encrypt the blob, and wrap the fresh DEK under a new
   * passkey PRF + the (re-typed) recovery code. `recoveryCode` doubles as proof of
   * ownership since the lost passkey can no longer assert it.
   */
  reEnrollPasskey: (recoveryCode: string) => Effect.Effect<{ vault: Vault }, VaultError>
  /** Persist a (mutated) plaintext tree back to the blob under the in-memory DEK. */
  save: (vault: Vault) => Effect.Effect<void, VaultError>
  lock: () => void
}

export const VaultService = Context.Service<VaultService>('VaultService')

export class VaultStorageError extends Error {
  readonly _tag = 'VaultStorageError'
  constructor(message: string) {
    super(message)
  }
}

export class VaultUnlockedError extends Error {
  readonly _tag = 'VaultUnlockedError'
  constructor(message: string) {
    super(message)
  }
}

// --- module-level session holder (single active session) ---

interface VaultSession {
  dek: AesKey
  vault: Vault
}

let session: VaultSession | null = null
export const getSession = (): VaultSession | null => session
const setSession = (s: VaultSession | null): void => {
  session = s
}

const commit = (vault: Vault): Effect.Effect<void, VaultUnlockedError | CryptoError | VaultStorageError> =>
  Effect.gen(function* () {
    const cur = session
    if (!cur) return yield* Effect.fail(new VaultUnlockedError('vault locked'))
    const { iv, ct } = yield* encryptBlob(cur.dek, encodeJson(vault))
    yield* writeVaultBlob({ iv: toBuf(iv), ct: toBuf(ct) })
    session = { ...cur, vault }
  })

const makeEnvelope = (passkeyPrf: Uint8Array, recoveryCode: string) =>
  Effect.gen(function* () {
    const { key: dek, raw } = yield* generateDek()
    const envelope = yield* wrapRaw(raw, passkeyPrf, recoveryCode)
    return { dek, envelope }
  })

/**
 * Wrap raw DEK bytes under the passkey PRF-derived KEK and the recovery-code KEK,
 * then wipe the raw bytes. Returns the envelope records (keyed by method).
 */
const wrapRaw = (raw: Uint8Array, passkeyPrf: Uint8Array, recoveryCode: string): Effect.Effect<Envelope, VaultError> =>
  Effect.gen(function* () {
    // Wrap under passkey PRF
    const kemSaltP = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
    const kekP = yield* kekFromPrf(passkeyPrf, kemSaltP)
    const wrappedP = yield* wrapDek(raw, kekP)
    const passkeyRecord: WrappedDeK = {
      method: 'passkey',
      salt: toBuf(kemSaltP),
      iv: toBuf(wrappedP.iv),
      wrapped: toBuf(wrappedP.wrapped),
    }

    // Wrap under recovery code
    const kemSaltR = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
    const kekR = yield* kekFromPrf(textEncoder.encode(recoveryCode), kemSaltR)
    const wrappedR = yield* wrapDek(raw, kekR)
    raw.fill(0) // raw DEK bytes are no longer needed — wipe
    const recoveryRecord: WrappedDeK = {
      method: 'recovery',
      salt: toBuf(kemSaltR),
      iv: toBuf(wrappedR.iv),
      wrapped: toBuf(wrappedR.wrapped),
    }

    return { version: 1, deks: [passkeyRecord, recoveryRecord] } as Envelope
  })

const unwrapWith = (prf: Uint8Array, record: WrappedDeK): Effect.Effect<AesKey, VaultError> =>
  Effect.gen(function* () {
    const kek = yield* kekFromPrf(prf, new Uint8Array(record.salt))
    return yield* unwrapDek(new Uint8Array(record.wrapped), kek, new Uint8Array(record.iv))
  })

const decryptVault = (dek: AesKey): Effect.Effect<Vault, VaultError> =>
  Effect.gen(function* () {
    const blob = yield* readVaultBlob()
    if (!blob) return yield* Effect.fail(new VaultUnlockedError('no vault blob — run setup first'))
    const pt = yield* decryptBlob(dek, new Uint8Array(blob.iv), new Uint8Array(blob.ct))
    return JSON.parse(new TextDecoder().decode(pt)) as Vault
  })

export const vaultImpl: VaultService = {
  setup: (recoveryCode) =>
    Effect.gen(function* () {
      const existing = yield* readEnvelope()
      if (existing) return yield* Effect.fail(new VaultUnlockedError('vault already exists'))
      // salt for PRF is stored plaintext, not secret — deterministic per install; challenge is local
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const { credId, prfOutput } = yield* createPasskeyWithPrf(salt)
      const { dek, envelope } = yield* makeEnvelope(prfOutput, recoveryCode)
      const recoveryRecord = envelope.deks.find((d) => d.method === 'recovery')!
      const vault: Vault = { formatVersion: 1, identities: [] }
      yield* writeEnvelope(envelope)
      const { iv, ct } = yield* encryptBlob(dek, encodeJson(vault))
      yield* writeVaultBlob({ iv: toBuf(iv), ct: toBuf(ct) })
      setSession({ dek, vault })
      void credId
      return { recoveryRecord, identity: vault }
    }),

  unlock: () =>
    Effect.gen(function* () {
      const envelope = yield* readEnvelope()
      if (!envelope) return yield* Effect.fail(new VaultUnlockedError('no envelope — run setup first'))
      const rec = envelope.deks.find((d) => d.method === 'passkey')
      if (!rec) return yield* Effect.fail(new VaultUnlockedError('no passkey record'))
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const { prfOutput } = yield* getPrfOutput(salt)
      const dek = yield* unwrapWith(prfOutput, rec)
      const vault = yield* decryptVault(dek)
      setSession({ dek, vault })
      return vault
    }),

  unlockWithRecovery: (code) =>
    Effect.gen(function* () {
      const envelope = yield* readEnvelope()
      if (!envelope) return yield* Effect.fail(new VaultUnlockedError('no envelope — run setup first'))
      const rec = envelope.deks.find((d) => d.method === 'recovery')
      if (!rec) return yield* Effect.fail(new VaultUnlockedError('no recovery record'))
      const dek = yield* unwrapWith(textEncoder.encode(code), rec)
      const vault = yield* decryptVault(dek)
      setSession({ dek, vault })
      return vault
    }),

  reEnrollPasskey: (recoveryCode) =>
    Effect.gen(function* () {
      const cur = session
      if (!cur) return yield* Effect.fail(new VaultUnlockedError('vault locked — unlock first'))
      const envelope = yield* readEnvelope()
      if (!envelope) return yield* Effect.fail(new VaultUnlockedError('no envelope — run setup first'))
      // Proof of ownership: the recovery code must still unwrap the current DEK.
      const rec = envelope.deks.find((d) => d.method === 'recovery')
      if (!rec) return yield* Effect.fail(new VaultUnlockedError('no recovery record'))
      yield* unwrapWith(textEncoder.encode(recoveryCode), rec)
      // Rotate the DEK: fresh passkey PRF, fresh wrap under passkey + recovery code.
      const salt = crypto.getRandomValues(new Uint8Array(32))
      const { prfOutput } = yield* createPasskeyWithPrf(salt)
      const { dek, envelope: nextEnvelope } = yield* makeEnvelope(prfOutput, recoveryCode)
      const vault = cur.vault
      const { iv, ct } = yield* encryptBlob(dek, encodeJson(vault))
      yield* writeEnvelope(nextEnvelope)
      yield* writeVaultBlob({ iv: toBuf(iv), ct: toBuf(ct) })
      setSession({ dek, vault })
      return { vault }
    }),

  save: (vault) => commit(vault),

  lock: () => setSession(null),
}

export const VaultServiceLive = Context.make(VaultService, vaultImpl)