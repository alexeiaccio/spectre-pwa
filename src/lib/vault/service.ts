import { Context, Effect, Layer, ManagedRuntime, Ref, Schema } from 'effect'
import {
  generateDek,
  kekFromPrf,
  unwrapDek,
  wrapDek,
  type AesKey,
} from './crypto-dek.ts'
import {
  getAllRecords,
  readDeviceEnvelope,
  readMeta,
  writeDeviceEnvelope,
  writeMeta,
  writeRecords,
} from './storage.ts'
import { createPasskeyWithPrf, getPrfOutput } from './passkey.ts'
import { decodeIdentityRecord, encodeIdentityRecord } from '../sync/records.ts'
import type { SyncRecord } from '../sync/types.ts'
import type { CryptoError } from './crypto-dek.ts'
import type { PasskeyError } from './passkey.ts'
import type { Envelope, Identity, Vault, WrappedDeK } from './schema.ts'

export type VaultError =
  | VaultStorageError
  | VaultUnlockedError
  | CryptoError
  | PasskeyError
export type { CryptoError, PasskeyError }

const textEncoder = new TextEncoder()
const KEK_SALT_BYTES = 16

/** Copy a Uint8Array into a fresh ArrayBuffer (schema stores ArrayBuffer). */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

// --- Service layer (Effect v4 function-style key) ---

export interface VaultService {
  /** First run: create passkey under PRF, generate DEK, wrap under passkey+recovery code, write the v3 mirror. */
  setup: (
    recoveryCode: string,
  ) => Effect.Effect<
    { recoveryRecord: WrappedDeK; identity: Vault },
    VaultError
  >
  /** Unlock via passkey: PRF → KEK → unwrap DEK → load the identity records. */
  unlock: () => Effect.Effect<Vault, VaultError>
  /** Recovery path: code → KEK → unwrap DEK → load the identity records. */
  unlockWithRecovery: (code: string) => Effect.Effect<Vault, VaultError>
  /**
   * Replace a lost passkey. Requires an active session. Rotates the DEK and
   * re-encrypts this device's records under the fresh DEK + new wraps.
   */
  reEnrollPasskey: (
    recoveryCode: string,
  ) => Effect.Effect<{ vault: Vault }, VaultError>
  /** Persist a (mutated) plaintext tree as per-identity records under the in-memory DEK. */
  save: (vault: Vault) => Effect.Effect<void, VaultError>
  /**
   * Complete a device join (S5): adopt the joined records + envelope + device
   * identity into the v3 mirror.
   */
  joinImport: (joined: {
    deviceId: string
    envelope: Envelope
    records: Map<string, SyncRecord>
    dek: AesKey
  }) => Effect.Effect<{ vault: Vault }, VaultError>
  /** Drop the in-memory session. */
  lock: () => Effect.Effect<void>
  /** The current unlocked session (null when locked). */
  session: () => Effect.Effect<VaultSession | null>
}

export const VaultService = Context.Service<VaultService>('VaultService')

export class VaultStorageError extends Schema.TaggedError<VaultStorageError>()(
  'VaultStorageError',
  { message: Schema.String },
) {}

export class VaultUnlockedError extends Schema.TaggedError<VaultUnlockedError>()(
  'VaultUnlockedError',
  { message: Schema.String },
) {}

/** The unlocked in-memory session: the vault DEK + decrypted tree. */
export interface VaultSession {
  dek: AesKey
  vault: Vault
}

const makeEnvelope = Effect.fn('vault.makeEnvelope')(function* (
  passkeyPrf: Uint8Array,
  passkeyPrfSalt: Uint8Array,
  passkeyCredId: string,
  recoveryCode: string,
): Effect.fn.Return<{ dek: AesKey; envelope: Envelope }, VaultError> {
  const { key: dek, raw } = yield* generateDek()
  const envelope = yield* wrapRaw(
    raw,
    passkeyPrf,
    passkeyPrfSalt,
    passkeyCredId,
    recoveryCode,
  )
  return { dek, envelope }
})

/**
 * Wrap raw DEK bytes under the passkey PRF-derived KEK and the recovery-code KEK,
 * then wipe the raw bytes. Returns the envelope records (keyed by method).
 * The passkey PRF salt + credential id are recorded so unlock() re-derives the
 * same PRF output from the same credential.
 */
const wrapRaw = Effect.fn('vault.wrapRaw')(function* (
  raw: Uint8Array,
  passkeyPrf: Uint8Array,
  passkeyPrfSalt: Uint8Array,
  passkeyCredId: string,
  recoveryCode: string,
): Effect.fn.Return<Envelope, VaultError> {
  // Wrap under passkey PRF
  const kemSaltP = crypto.getRandomValues(new Uint8Array(KEK_SALT_BYTES))
  const kekP = yield* kekFromPrf(passkeyPrf, kemSaltP)
  const wrappedP = yield* wrapDek(raw, kekP)
  const passkeyRecord: WrappedDeK = {
    method: 'passkey',
    salt: toBuf(kemSaltP),
    prfSalt: toBuf(passkeyPrfSalt),
    credId: passkeyCredId,
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

  return { version: 1, deks: [passkeyRecord, recoveryRecord] }
})

const unwrapWith = Effect.fn('vault.unwrapWith')(function* (
  prf: Uint8Array,
  record: WrappedDeK,
): Effect.fn.Return<AesKey, VaultError> {
  const kek = yield* kekFromPrf(prf, new Uint8Array(record.salt))
  return yield* unwrapDek(
    new Uint8Array(record.wrapped),
    kek,
    new Uint8Array(record.iv),
  )
})

/**
 * Write every identity of `vault` as a live record under `dek`/`deviceId`,
 * tombstoning any identity present in `prevIds` but absent from `vault`.
 */
const writeVault = Effect.fn('vault.writeVault')(function* (
  dek: AesKey,
  deviceId: string,
  prevIds: ReadonlyArray<string>,
  vault: Vault,
): Effect.fn.Return<void, VaultError> {
  const entries: Array<readonly [string, SyncRecord]> = []
  for (const identity of vault.identities) {
    const record = yield* encodeIdentityRecord(dek, identity, deviceId)
    entries.push([identity.id, record])
  }
  const remaining = new Set(prevIds)
  for (const identity of vault.identities) remaining.delete(identity.id)
  for (const removed of remaining) {
    entries.push([removed, { v: 2, kind: 'tombstone' }])
  }
  yield* writeRecords(entries)
})

/**
 * Load the vault from the mirror: decrypt each live record under the local DEK.
 * (Post-join the mirror's records are all under this device's DEK;
 * foreign-writer records from live sync are M8's lazy-decrypt path.)
 */
const loadVault = Effect.fn('vault.loadVault')(function* (
  dek: AesKey,
): Effect.fn.Return<Vault, VaultError> {
  const records = yield* getAllRecords()
  const identities: Identity[] = []
  for (const [, record] of records) {
    if (record.kind === 'tombstone') continue
    const identity = yield* decodeIdentityRecord(dek, record)
    identities.push(identity)
  }
  return { formatVersion: 1, identities }
})

/** The current device's id from the mirror meta. */
const requireDeviceId = Effect.fn('vault.requireDeviceId')(
  function* (): Effect.fn.Return<string, VaultError> {
    const meta = yield* readMeta()
    if (!meta?.deviceId)
      return yield* new VaultUnlockedError({ message: 'no device identity' })
    return meta.deviceId
  },
)

const unwrapSessionDek = Effect.fn('vault.unwrapSessionDek')(function* (
  method: { kind: 'passkey' } | { kind: 'recovery'; code: string },
  envelope: Envelope,
): Effect.fn.Return<AesKey, VaultError> {
  if (method.kind === 'passkey') {
    const rec = envelope.deks.find((d) => d.method === 'passkey')
    if (!rec)
      return yield* new VaultUnlockedError({ message: 'no passkey record' })
    if (!rec.prfSalt || !rec.credId)
      return yield* new VaultUnlockedError({
        message:
          'passkey record is incomplete — unlock with the recovery code or re-enroll',
      })
    const { prfOutput } = yield* getPrfOutput(
      new Uint8Array(rec.prfSalt),
      rec.credId,
    )
    return yield* unwrapWith(prfOutput, rec)
  }
  const rec = envelope.deks.find((d) => d.method === 'recovery')
  if (!rec)
    return yield* new VaultUnlockedError({ message: 'no recovery record' })
  return yield* unwrapWith(textEncoder.encode(method.code), rec)
})

/** The session `Ref` is created inside `VaultServiceLive` so it is per-runtime, not module-global. */
const makeVaultImpl = (
  session: Ref.Ref<VaultSession | null>,
): VaultService => ({
  setup: Effect.fn('VaultService.setup')(function* (
    recoveryCode: string,
  ): Effect.fn.Return<
    { recoveryRecord: WrappedDeK; identity: Vault },
    VaultError
  > {
    const existing = yield* readMeta()
    if (existing?.deviceId)
      return yield* new VaultUnlockedError({
        message: 'vault already exists',
      })
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const { credId, prfOutput } = yield* createPasskeyWithPrf(salt)
    const { dek, envelope } = yield* makeEnvelope(
      prfOutput,
      salt,
      credId,
      recoveryCode,
    )
    const deviceId = crypto.randomUUID()
    yield* writeDeviceEnvelope(deviceId, envelope)
    yield* writeMeta({ deviceId })
    const vault: Vault = { formatVersion: 1, identities: [] }
    yield* Ref.set(session, { dek, vault })
    const recoveryRecord = envelope.deks.find((d) => d.method === 'recovery')!
    return { recoveryRecord, identity: vault }
  }),

  unlock: Effect.fn('VaultService.unlock')(function* (): Effect.fn.Return<
    Vault,
    VaultError
  > {
    const deviceId = yield* requireDeviceId()
    const envelope = yield* readDeviceEnvelope(deviceId)
    if (!envelope)
      return yield* new VaultUnlockedError({
        message: 'no envelope for device',
      })
    const dek = yield* unwrapSessionDek({ kind: 'passkey' }, envelope)
    const vault = yield* loadVault(dek)
    yield* Ref.set(session, { dek, vault })
    return vault
  }),

  unlockWithRecovery: Effect.fn('VaultService.unlockWithRecovery')(function* (
    code: string,
  ): Effect.fn.Return<Vault, VaultError> {
    const deviceId = yield* requireDeviceId()
    const envelope = yield* readDeviceEnvelope(deviceId)
    if (!envelope)
      return yield* new VaultUnlockedError({
        message: 'no envelope for device',
      })
    const dek = yield* unwrapSessionDek({ kind: 'recovery', code }, envelope)
    const vault = yield* loadVault(dek)
    yield* Ref.set(session, { dek, vault })
    return vault
  }),

  reEnrollPasskey: Effect.fn('VaultService.reEnrollPasskey')(function* (
    recoveryCode: string,
  ): Effect.fn.Return<{ vault: Vault }, VaultError> {
    const cur = yield* Ref.get(session)
    if (!cur)
      return yield* new VaultUnlockedError({
        message: 'vault locked — unlock first',
      })
    const deviceId = yield* requireDeviceId()
    const envelope = yield* readDeviceEnvelope(deviceId)
    if (!envelope)
      return yield* new VaultUnlockedError({
        message: 'no envelope for device',
      })
    // Proof of ownership: the recovery code must still unwrap the current DEK.
    const rec = envelope.deks.find((d) => d.method === 'recovery')
    if (!rec)
      return yield* new VaultUnlockedError({ message: 'no recovery record' })
    yield* unwrapWith(textEncoder.encode(recoveryCode), rec)
    // Rotate the DEK: fresh passkey PRF, fresh wrap under passkey + recovery code.
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const { credId, prfOutput } = yield* createPasskeyWithPrf(salt)
    const { dek, envelope: nextEnvelope } = yield* makeEnvelope(
      prfOutput,
      salt,
      credId,
      recoveryCode,
    )
    yield* writeDeviceEnvelope(deviceId, nextEnvelope)
    yield* writeVault(
      dek,
      deviceId,
      cur.vault.identities.map((i) => i.id),
      cur.vault,
    )
    yield* Ref.set(session, { dek, vault: cur.vault })
    return { vault: cur.vault }
  }),

  save: Effect.fn('VaultService.save')(function* (
    vault: Vault,
  ): Effect.fn.Return<void, VaultError> {
    const cur = yield* Ref.get(session)
    if (!cur) return yield* new VaultUnlockedError({ message: 'vault locked' })
    const deviceId = yield* requireDeviceId()
    yield* writeVault(
      cur.dek,
      deviceId,
      cur.vault.identities.map((i) => i.id),
      vault,
    )
    yield* Ref.set(session, { ...cur, vault })
  }),

  joinImport: Effect.fn('VaultService.joinImport')(function* (joined: {
    deviceId: string
    envelope: Envelope
    records: Map<string, SyncRecord>
    dek: AesKey
  }): Effect.fn.Return<{ vault: Vault }, VaultError> {
    yield* writeDeviceEnvelope(joined.deviceId, joined.envelope)
    yield* writeRecords(joined.records)
    yield* writeMeta({ deviceId: joined.deviceId })
    // Load the joined identities back from the records (they are under DEK-B).
    const loaded = yield* loadVault(joined.dek)
    yield* Ref.set(session, { dek: joined.dek, vault: loaded })
    return { vault: loaded }
  }),

  lock: () => Ref.set(session, null),

  session: () => Ref.get(session),
})

export const VaultServiceLive = Layer.effect(
  VaultService,
  Effect.gen(function* () {
    const session = yield* Ref.make<VaultSession | null>(null)
    return makeVaultImpl(session)
  }),
)

// --- App bridge: one runtime holds the live layer; `vaultImpl` delegates to it. ---

const vaultRuntime = ManagedRuntime.make(VaultServiceLive)
let resolved: VaultService | null = null
const service = (): VaultService =>
  (resolved ??= vaultRuntime.runSync(VaultService))

/** Module-level facade over `VaultServiceLive`. The session state lives in the layer's Ref. */
export const vaultImpl: VaultService = {
  setup: (recoveryCode) => service().setup(recoveryCode),
  unlock: () => service().unlock(),
  unlockWithRecovery: (code) => service().unlockWithRecovery(code),
  reEnrollPasskey: (code) => service().reEnrollPasskey(code),
  save: (vault) => service().save(vault),
  joinImport: (joined) => service().joinImport(joined),
  lock: () => service().lock(),
  session: () => service().session(),
}
