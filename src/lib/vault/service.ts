import { Context, Effect, Layer, ManagedRuntime, Ref, Schema } from 'effect'
import {
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
} from '@effect/platform-browser'
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
import {
  decryptRekey,
  encryptRekey,
  generateDeviceKeypair,
  generateGroupKey,
  importGroupKey,
  unwrapRawSecret,
  wrapGroupKeyUnder,
} from '../sync/group.ts'
import { createPasskeyWithPrf, getPrfOutput } from './passkey.ts'
import { decodeIdentityRecord, encodeIdentityRecord } from '../sync/records.ts'
import type { GroupEnvelope, RekeyRecord, SyncRecord } from '../sync/types.ts'
import type { CryptoError } from './crypto-dek.ts'
import type { PasskeyError } from './passkey.ts'
import type { Envelope, Identity, Vault, WrappedDeK } from './schema.ts'

type VaultError =
  | IndexedDbDatabase.IndexedDbDatabaseError
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | VaultUnlockedError
  | CryptoError
  | PasskeyError

const textEncoder = new TextEncoder()

// --- Service layer (Effect v4 function-style key) ---

interface VaultService {
  /** First run: create passkey under PRF, generate DEK, wrap under passkey+recovery code, write the v3 mirror. */
  setup: (
    recoveryCode: string,
  ) => Effect.Effect<
    { recoveryRecord: WrappedDeK; identity: Vault },
    VaultError
  >
  /**
   * First run without a passkey (no PRF-capable authenticator, e.g. an
   * installed PWA on macOS): the DEK is wrapped under the recovery code alone.
   * A passkey can be enrolled later via reEnrollPasskey from a PRF-capable
   * context (browser tab).
   */
  setupRecoveryOnly: (
    recoveryCode: string,
  ) => Effect.Effect<{ identity: Vault }, VaultError>
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
    devicePrivatePkcs8?: Uint8Array
  }) => Effect.Effect<{ vault: Vault }, VaultError>
  /** Raw group-key bytes (K, extractable) from the live session — for invitations (GS2/GS3). */
  exportGroupKey: () => Effect.Effect<Uint8Array, VaultError>
  /**
   * GS6: consume a device rekey record in the background — decrypt K′ with this
   * device's ECDH private, rewrap under its own unlock, re-encrypt the mirror
   * under K′, and switch the session to K′.
   */
  applyRekey: (rekey: RekeyRecord) => Effect.Effect<{ vault: Vault }, VaultError>
  /**
   * GS6: host-side revocation — rotate to a new group key K′, re-encrypt all
   * shared records, rewrap K′ into the host's envelope (using the in-session
   * unlock), and emit a rekey record to each remaining device. Uses the live
   * session, so no passphrase prompt is needed.
   */
  revokeDevices: (args: {
    identities: readonly Identity[]
    removedDeviceIds: ReadonlySet<string>
    remainingEnvelopes: ReadonlyMap<string, GroupEnvelope>
  }) => Effect.Effect<
    {
      records: Map<string, SyncRecord>
      rekeys: Map<string, RekeyRecord>
      hostEnvelope: GroupEnvelope
    },
    VaultError
  >
  /** Drop the in-memory session. */
  lock: () => Effect.Effect<void>
  /** The current unlocked session (null when locked). */
  session: () => Effect.Effect<VaultSession | null>
}

const VaultService = Context.Service<VaultService>('VaultService')

class VaultUnlockedError extends Schema.TaggedError<VaultUnlockedError>()(
  'VaultUnlockedError',
  { message: Schema.String },
) {}

/** The unlocked in-memory session: the group key K + decrypted tree (+ device ECDH private + unlock secret for GS6 rekey). */
interface VaultSession {
  dek: AesKey
  vault: Vault
  /** GS6: this device's ECDH private key (pkcs8), to consume rekeys in the background. */
  devicePrivatePkcs8?: Uint8Array
  /** The unwrap secret (PRF output or recovery-code bytes) + its KEK salt, to rewrap after a rekey. */
  unlockSecret?: Uint8Array
  unlockSalt?: Uint8Array
  unlockMethod?: 'passkey' | 'recovery'
}

const wrapKeyBytes = Effect.fn('vault.wrapKeyBytes')(function* (
  raw: Uint8Array,
  recoveryCode: string,
  passkey?: { prf: Uint8Array; prfSalt: Uint8Array; credId: string },
): Effect.fn.Return<WrappedDeK[], VaultError> {
  return yield* wrapGroupKeyUnder({
    raw: new Uint8Array(raw),
    passphrase: recoveryCode,
    passkeyPrf: passkey?.prf,
    passkeyPrfSalt: passkey?.prfSalt,
    passkeyCredId: passkey?.credId,
  })
})

/**
 * First-run vault creation: the session key IS the group key K (extractable,
 * GS3). Also mints this device's ECDH keypair (GS6): the public key goes
 * plaintext into the envelope so the group can rekey to this device, and the
 * private key (pkcs8) is wrapped under the device's own unlock.
 */
const mintDeviceEnvelope = Effect.fn('vault.mintDeviceEnvelope')(function* (
  recoveryCode: string,
  passkey?: { prf: Uint8Array; prfSalt: Uint8Array; credId: string },
): Effect.fn.Return<
  { dek: AesKey; envelope: Envelope; devicePrivatePkcs8: Uint8Array },
  VaultError
> {
  const { key: dek, raw } = yield* generateDek()
  const device = yield* generateDeviceKeypair()
  const deks = yield* wrapKeyBytes(raw, recoveryCode, passkey)
  const deviceSecret = yield* wrapKeyBytes(device.privatePkcs8, recoveryCode, passkey)
  return {
    dek,
    envelope: {
      version: 2,
      deks,
      devicePublic: device.publicRaw.slice().buffer,
      deviceSecret,
    },
    devicePrivatePkcs8: device.privatePkcs8,
  }
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
 * Load the vault from the mirror: decrypt each live record under K. A record
 * it can't decrypt (stale/cross-epoch, or a foreign record under an old key)
 * is skipped so a single bad record never bricks unlock — it just omits that
 * identity. (GS6 note: this is how a vault survives leftover records from an
 * old group key epoch or a legacy per-device-DEK write.)
 */
const loadVault = Effect.fn('vault.loadVault')(function* (
  dek: AesKey,
): Effect.fn.Return<Vault, VaultError> {
  const records = yield* getAllRecords()
  const identities: Identity[] = []
  for (const [, record] of records) {
    if (record.kind === 'tombstone') continue
    const identity = yield* decodeIdentityRecord(dek, record).pipe(
      Effect.matchEffect({
        onSuccess: (i) => Effect.succeed(i),
        onFailure: () => Effect.succeed(null as Identity | null),
      }),
    )
    if (identity) identities.push(identity)
    // else: skip undecryptable record (stale key/epoch) — don't brick unlock
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

/** GS6: unwrap this device's ECDH private (for background rekey consume). */
const unwrapDevicePrivate = Effect.fn('vault.unwrapDevicePrivate')(function* (
  method: { kind: 'passkey' } | { kind: 'recovery'; code: string },
  envelope: Envelope,
): Effect.fn.Return<Uint8Array | undefined, VaultError> {
  if (!envelope.deviceSecret || envelope.deviceSecret.length === 0)
    return undefined
  if (method.kind === 'passkey') {
    const rec = envelope.deviceSecret.find((d) => d.method === 'passkey')
    if (!rec?.prfSalt || !rec.credId) return undefined
    const { prfOutput } = yield* getPrfOutput(
      new Uint8Array(rec.prfSalt),
      rec.credId,
    )
    return yield* unwrapRawSecret(envelope.deviceSecret, 'passkey', prfOutput)
  }
  return yield* unwrapRawSecret(
    envelope.deviceSecret,
    'recovery',
    textEncoder.encode(method.code),
  )
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
    const { dek, envelope, devicePrivatePkcs8 } = yield* mintDeviceEnvelope(
      recoveryCode,
      { prf: prfOutput, prfSalt: salt, credId },
    )
    const deviceId = crypto.randomUUID()
    yield* writeDeviceEnvelope(deviceId, envelope)
    yield* writeMeta({ deviceId })
    const vault: Vault = { formatVersion: 1, identities: [] }
    yield* Ref.set(session, { dek, vault, devicePrivatePkcs8 })
    const recoveryRecord = envelope.deks.find((d) => d.method === 'recovery')!
    return { recoveryRecord, identity: vault }
  }),

  setupRecoveryOnly: Effect.fn('VaultService.setupRecoveryOnly')(function* (
    recoveryCode: string,
  ): Effect.fn.Return<{ identity: Vault }, VaultError> {
    const existing = yield* readMeta()
    if (existing?.deviceId)
      return yield* new VaultUnlockedError({
        message: 'vault already exists',
      })
    const { dek, envelope, devicePrivatePkcs8 } = yield* mintDeviceEnvelope(
      recoveryCode,
    )
    const deviceId = crypto.randomUUID()
    yield* writeDeviceEnvelope(deviceId, envelope)
    yield* writeMeta({ deviceId })
    const vault: Vault = { formatVersion: 1, identities: [] }
    yield* Ref.set(session, { dek, vault, devicePrivatePkcs8 })
    return { identity: vault }
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
    const pRec = envelope.deks.find((d) => d.method === 'passkey')
    if (!pRec?.prfSalt || !pRec.credId)
      return yield* new VaultUnlockedError({
        message: 'no passkey record — unlock with the recovery code or re-enroll',
      })
    // ONE passkey prompt; reuse the derived PRF for both the group key K and
    // the device ECDH secret (G6 `getPrfOutput` calls = one dialogue, not two).
    const { prfOutput } = yield* getPrfOutput(
      new Uint8Array(pRec.prfSalt),
      pRec.credId,
    )
    const dek = yield* unwrapWith(prfOutput, pRec)
    // Graceful like the pre-regression path: only unwrap the device secret if
    // it actually has a passkey wrap (its only key material was minted
    // passkey+recovery, but recovery-only / legacy envelopes may lack one).
    const devicePrivatePkcs8 =
      envelope.deviceSecret?.some((d) => d.method === 'passkey')
        ? yield* unwrapRawSecret(envelope.deviceSecret, 'passkey', prfOutput)
        : undefined
    const vault = yield* loadVault(dek)
    yield* Ref.set(session, {
      dek,
      vault,
      devicePrivatePkcs8,
      unlockSecret: prfOutput,
      unlockSalt: new Uint8Array(pRec.salt),
      unlockMethod: 'passkey',
    })
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
    const devicePrivatePkcs8 = yield* unwrapDevicePrivate(
      { kind: 'recovery', code },
      envelope,
    )
    const rRec = envelope.deks.find((d) => d.method === 'recovery')
    const unlockSecret = textEncoder.encode(code)
    const vault = yield* loadVault(dek)
    yield* Ref.set(session, {
      dek,
      vault,
      devicePrivatePkcs8,
      unlockSecret,
      unlockSalt: rRec ? new Uint8Array(rRec.salt) : undefined,
      unlockMethod: 'recovery',
    })
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
    // Rotate the DEK: fresh passkey PRF, fresh wrap; keep this device's ECDH
    // identity (same devicePublic/private), just re-wrap the private under the
    // new passkey + code.
    const salt = crypto.getRandomValues(new Uint8Array(32))
    const { credId, prfOutput } = yield* createPasskeyWithPrf(salt)
    const passkey = { prf: prfOutput, prfSalt: salt, credId }
    const { key: dek, raw } = yield* generateDek()
    const deks = yield* wrapKeyBytes(raw, recoveryCode, passkey)
    const devicePrivatePkcs8 = cur.devicePrivatePkcs8
    const deviceSecret = devicePrivatePkcs8
      ? yield* wrapKeyBytes(devicePrivatePkcs8, recoveryCode, passkey)
      : []
    const nextEnvelope: Envelope = {
      version: envelope.version ?? 2,
      deks,
      groupId: envelope.groupId,
      devicePublic: envelope.devicePublic,
      deviceSecret,
    }
    yield* writeDeviceEnvelope(deviceId, nextEnvelope)
    yield* writeVault(
      dek,
      deviceId,
      cur.vault.identities.map((i) => i.id),
      cur.vault,
    )
    yield* Ref.set(session, { dek, vault: cur.vault, devicePrivatePkcs8 })
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
    return yield* Ref.set(session, { ...cur, vault })
  }),

  joinImport: Effect.fn('VaultService.joinImport')(function* (joined: {
    deviceId: string
    envelope: Envelope
    records: Map<string, SyncRecord>
    dek: AesKey
    /** GS6: this device's ECDH private (computed at join from its own unlock). */
    devicePrivatePkcs8?: Uint8Array
  }): Effect.fn.Return<{ vault: Vault }, VaultError> {
    yield* writeDeviceEnvelope(joined.deviceId, joined.envelope)
    yield* writeRecords(joined.records)
    yield* writeMeta({ deviceId: joined.deviceId })
    // Load the joined identities back from the records (they are under K).
    const loaded = yield* loadVault(joined.dek)
    yield* Ref.set(session, {
      dek: joined.dek,
      vault: loaded,
      devicePrivatePkcs8: joined.devicePrivatePkcs8,
    })
    return { vault: loaded }
  }),

  exportGroupKey: Effect.fn('VaultService.exportGroupKey')(function* (): Effect.fn.Return<
    Uint8Array,
    VaultError
  > {
    const cur = yield* Ref.get(session)
    if (!cur) return yield* new VaultUnlockedError({ message: 'vault locked' })
    const raw = yield* Effect.tryPromise(() =>
      crypto.subtle.exportKey('raw', cur.dek),
    ).pipe(
      Effect.mapError(
        () => new VaultUnlockedError({ message: 'exportGroupKey failed' }),
      ),
    )
    return new Uint8Array(raw)
  }),

  applyRekey: Effect.fn('VaultService.applyRekey')(function* (
    rekey: RekeyRecord,
  ): Effect.fn.Return<{ vault: Vault }, VaultError> {
    const cur = yield* Ref.get(session)
    if (!cur?.devicePrivatePkcs8 || !cur.unlockSecret || !cur.unlockMethod || !cur.unlockSalt)
      return yield* new VaultUnlockedError({ message: 'vault locked or no device key' })
    const meta = yield* readMeta()
    if (!meta?.deviceId) return yield* new VaultUnlockedError({ message: 'no device identity' })
    const env = yield* readDeviceEnvelope(meta.deviceId)
    if (!env) return yield* new VaultUnlockedError({ message: 'no envelope' })

    const kpRaw = yield* decryptRekey(new Uint8Array(cur.devicePrivatePkcs8), {
      ephPublic: new Uint8Array(rekey.ephPublic),
      iv: new Uint8Array(rekey.iv),
      ct: new Uint8Array(rekey.ct),
    })
    const kpKey = yield* importGroupKey(new Uint8Array(kpRaw))

    // Rewrap K′ under the device's own KEK (same unlock secret + salt as the
    // method just used). Only that method is kept — it's the only wrap whose
    // secret is available at background time; the other path can be restored by
    // re-enrolling.
    const kek = yield* kekFromPrf(new Uint8Array(cur.unlockSecret), new Uint8Array(cur.unlockSalt))
    const wrapped = yield* wrapDek(new Uint8Array(kpRaw), kek)
    const old = env.deks.find((d) => d.method === cur.unlockMethod)
    const deks = [{
      method: cur.unlockMethod,
      salt: cur.unlockSalt.slice().buffer,
      prfSalt: cur.unlockMethod === 'passkey' ? old?.prfSalt : undefined,
      credId: cur.unlockMethod === 'passkey' ? old?.credId : undefined,
      iv: wrapped.iv.slice().buffer,
      wrapped: wrapped.wrapped.slice().buffer,
    }]
    yield* writeDeviceEnvelope(meta.deviceId, { ...env, deks })
    yield* writeVault(kpKey, meta.deviceId, cur.vault.identities.map((i) => i.id), cur.vault)
    yield* Ref.set(session, { ...cur, dek: kpKey })
    return { vault: cur.vault }
  }),

  revokeDevices: Effect.fn('VaultService.revokeDevices')(function* (args: {
    identities: readonly Identity[]
    removedDeviceIds: ReadonlySet<string>
    remainingEnvelopes: ReadonlyMap<string, GroupEnvelope>
  }): Effect.fn.Return<
    {
      records: Map<string, SyncRecord>
      rekeys: Map<string, RekeyRecord>
      hostEnvelope: GroupEnvelope
    },
    VaultError
  > {
    const cur = yield* Ref.get(session)
    if (!cur || !cur.unlockSecret || !cur.unlockMethod || !cur.unlockSalt)
      return yield* new VaultUnlockedError({ message: 'vault locked' })
    const meta = yield* readMeta()
    if (!meta?.deviceId) return yield* new VaultUnlockedError({ message: 'no device identity' })
    const env = yield* readDeviceEnvelope(meta.deviceId)
    if (!env) return yield* new VaultUnlockedError({ message: 'no envelope' })

    const { raw: kpRaw } = yield* generateGroupKey()
    const kpKey = yield* importGroupKey(new Uint8Array(kpRaw))

    // Re-encrypt every shared identity under K′.
    const records = new Map<string, SyncRecord>()
    for (const identity of args.identities) {
      const rec = yield* encodeIdentityRecord(kpKey, identity, meta.deviceId)
      records.set(identity.id, rec)
    }

    // Rewrap K′ into the host envelope under the in-session unlock.
    const kek = yield* kekFromPrf(new Uint8Array(cur.unlockSecret), new Uint8Array(cur.unlockSalt))
    const wrapped = yield* wrapDek(new Uint8Array(kpRaw), kek)
    const old = env.deks.find((d) => d.method === cur.unlockMethod)
    const hostDeks = [{
      method: cur.unlockMethod,
      salt: cur.unlockSalt.slice().buffer,
      prfSalt: cur.unlockMethod === 'passkey' ? old?.prfSalt : undefined,
      credId: cur.unlockMethod === 'passkey' ? old?.credId : undefined,
      iv: wrapped.iv.slice().buffer,
      wrapped: wrapped.wrapped.slice().buffer,
    }]
    const hostEnvelope: Envelope = { ...env, deks: hostDeks }
    yield* writeDeviceEnvelope(meta.deviceId, hostEnvelope)
    const hostDocEnvelope: GroupEnvelope = {
      v: 2,
      groupId: env.groupId ?? '',
      deviceId: meta.deviceId,
      deks: hostDeks,
      devicePublic: env.devicePublic ?? new ArrayBuffer(0),
      deviceSecret: env.deviceSecret ?? [],
    }

    // Emit a rekey to each remaining (non-host, non-removed) device.
    const rekeys = new Map<string, RekeyRecord>()
    for (const [id, gEnv] of args.remainingEnvelopes) {
      if (id === meta.deviceId || args.removedDeviceIds.has(id)) continue
      if (gEnv.devicePublic.byteLength === 0) continue
      const rk = yield* encryptRekey(new Uint8Array(gEnv.devicePublic), new Uint8Array(kpRaw))
      rekeys.set(id, {
        v: 1,
        ephPublic: rk.ephPublic.slice().buffer,
        iv: rk.iv.slice().buffer,
        ct: rk.ct.slice().buffer,
      })
    }

    // Switch this host to K′ locally (mirror re-encrypted under K′).
    yield* writeVault(kpKey, meta.deviceId, cur.vault.identities.map((i) => i.id), cur.vault)
    yield* Ref.set(session, { ...cur, dek: kpKey })

    return { records, rekeys, hostEnvelope: hostDocEnvelope }
  }),

  lock: () => Ref.set(session, null),

  session: () => Ref.get(session),
})

const VaultServiceLive = Layer.effect(
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
  setupRecoveryOnly: (recoveryCode) =>
    service().setupRecoveryOnly(recoveryCode),
  unlock: () => service().unlock(),
  unlockWithRecovery: (code) => service().unlockWithRecovery(code),
  reEnrollPasskey: (code) => service().reEnrollPasskey(code),
  save: (vault) => service().save(vault),
  joinImport: (joined) => service().joinImport(joined),
  exportGroupKey: () => service().exportGroupKey(),
  applyRekey: (rekey) => service().applyRekey(rekey),
  revokeDevices: (args) => service().revokeDevices(args),
  lock: () => service().lock(),
  session: () => service().session(),
}
