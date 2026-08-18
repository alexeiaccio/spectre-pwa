import { Effect } from 'effect'
import { CryptoError } from '../vault/crypto-dek.ts'
import {
  decryptRekey,
  encryptRekey,
  generateGroupKey,
  importGroupKey,
  unwrapRawSecret,
  wrapGroupKeyUnder,
} from './group.ts'
import { encodeIdentityRecord } from './records.ts'
import type { GroupEnvelope, RekeyRecord, SyncRecord } from './types.ts'
import type { Identity } from '../vault/schema.ts'

// GS6: real device revocation via group-key rotation. Rotating K → K′ force-
// re-encrypts all shared records and hands K′ only to the remaining devices
// through per-device ECDH rekey records (`rekey/<deviceId>`). A removed device
// gets no rekey for itself and can't decrypt anyone else's (it lacks their
// `deviceSecret`), so it stays on the old epoch and can no longer read/write.

const textEncoder = new TextEncoder()

export interface RotateResult {
  /** All shared identities re-encrypted under K′. */
  records: Map<string, SyncRecord>
  /** Per-device rekey records for remaining (non-host, non-removed) devices. */
  rekeys: Map<string, RekeyRecord>
  /** The acting host's new envelope wrapping K′ (device keys unchanged). */
  hostEnvelope: GroupEnvelope
  /** Raw K′ — host imports this as its new session key; wipe after handling. */
  groupKeyPrimeRaw: Uint8Array
}

/**
 * Host-side rotation (GS6): generate K′, re-encrypt every shared identity
 * under it, rewrap K′ into the host's own envelope, and emit a per-device
 * rekey record to each remaining group device (excluding the removed ones and
 * the host). Caller writes `records` + `hostEnvelope` + each `rekey` to the
 * doc. The acting device must supply its own unlock material to rewrap K′.
 */
export const rotateGroupKey = Effect.fn('sync.rotateGroupKey')(
  function* (args: {
    identities: readonly Identity[]
    deviceId: string
    passphrase: string
    passkeyPrf?: Uint8Array
    passkeyPrfSalt?: Uint8Array
    passkeyCredId?: string
    removedDeviceIds: ReadonlySet<string>
    /** Every remaining device's group envelope (incl. the host's) keyed by id. */
    remainingEnvelopes: ReadonlyMap<string, GroupEnvelope>
  }): Effect.fn.Return<RotateResult, CryptoError> {
    const { raw: kpRaw } = yield* generateGroupKey()
    const kpKey = yield* importGroupKey(new Uint8Array(kpRaw))

    const records = new Map<string, SyncRecord>()
    for (const identity of args.identities) {
      const rec = yield* encodeIdentityRecord(kpKey, identity, args.deviceId)
      records.set(identity.id, rec)
    }

    const hostEnv = args.remainingEnvelopes.get(args.deviceId)
    if (!hostEnv)
      return yield* new CryptoError({ message: 'host envelope is missing' })
    const deks = yield* wrapGroupKeyUnder({
      raw: new Uint8Array(kpRaw),
      passphrase: args.passphrase,
      passkeyPrf: args.passkeyPrf,
      passkeyPrfSalt: args.passkeyPrfSalt,
      passkeyCredId: args.passkeyCredId,
    })
    const hostEnvelope: GroupEnvelope = { ...hostEnv, deks }

    const rekeys = new Map<string, RekeyRecord>()
    for (const [id, env] of args.remainingEnvelopes) {
      if (id === args.deviceId || args.removedDeviceIds.has(id)) continue
      if (env.devicePublic.byteLength === 0) continue // device has no ECDH key
      const rekey = yield* encryptRekey(
        new Uint8Array(env.devicePublic),
        new Uint8Array(kpRaw),
      )
      rekeys.set(id, {
        v: 1,
        ephPublic: rekey.ephPublic.slice().buffer,
        iv: rekey.iv.slice().buffer,
        ct: rekey.ct.slice().buffer,
      })
    }

    return { records, rekeys, hostEnvelope, groupKeyPrimeRaw: new Uint8Array(kpRaw) }
  },
)

export interface ConsumeRekeyResult {
  /** Raw K′ — import as the device's new session key; wipe after rewrapping. */
  groupKeyPrimeRaw: Uint8Array
  /** This device's envelope now wrapping K′ (device keys unchanged). */
  envelope: GroupEnvelope
}

/**
 * Device-side: decrypt a rekey record addressed to this device (ECDH with its
 * own `deviceSecret`), recover K′, and rewrap K′ under this device's own
 * unlock. Uses the passkey PRF if given, else the per-device passphrase.
 */
export const consumeRekey = Effect.fn('sync.consumeRekey')(
  function* (args: {
    rekey: RekeyRecord
    myEnvelope: GroupEnvelope
    passphrase: string
    passkeyPrf?: Uint8Array
    passkeyPrfSalt?: Uint8Array
    passkeyCredId?: string
  }): Effect.fn.Return<ConsumeRekeyResult, CryptoError> {
    const privKind = args.passkeyPrf ? 'passkey' : 'recovery'
    const secret = args.passkeyPrf
      ? args.passkeyPrf
      : textEncoder.encode(args.passphrase)
    const priv = yield* unwrapRawSecret(
      args.myEnvelope.deviceSecret,
      privKind,
      secret,
    )
    const kpRaw = yield* decryptRekey(priv, {
      ephPublic: new Uint8Array(args.rekey.ephPublic),
      iv: new Uint8Array(args.rekey.iv),
      ct: new Uint8Array(args.rekey.ct),
    })
    const deks = yield* wrapGroupKeyUnder({
      raw: new Uint8Array(kpRaw),
      passphrase: args.passphrase,
      passkeyPrf: args.passkeyPrf,
      passkeyPrfSalt: args.passkeyPrfSalt,
      passkeyCredId: args.passkeyCredId,
    })
    const envelope: GroupEnvelope = { ...args.myEnvelope, deks }
    return { groupKeyPrimeRaw: kpRaw, envelope }
  },
)
