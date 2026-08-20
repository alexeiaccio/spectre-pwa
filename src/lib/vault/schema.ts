import { Schema } from 'effect'

export const DB_NAME = 'spectre-pocket'

export const ENVELOPE_STORE = 'envelope'
export const PREFS_STORE = 'prefs'
export const RECORDS_STORE = 'records'
export const NODE_STORE = 'node'
export const META_STORE = 'meta'

/** Algorithm version per spectre-types (2012:03=0, 2012:07=1, 2014:09=2, 2015:01=3). */
type AlgorithmVersion = 0 | 1 | 2 | 3

type SitePurpose = 'password' | 'login' | 'answer'

export interface Site {
  id: string
  /** Site domain / label, e.g. "twitter.com". */
  name: string
  /** Spectre site counter (default 1). */
  counter: number
  /** resultType id mapped to password templates. */
  template: number
  purpose: SitePurpose
  answer?: string
}

export interface Identity {
  id: string
  /** Full name as used by the Spectre algorithm. Plaintext *inside* the blob. */
  fullName: string
  algorithm: AlgorithmVersion
  sites: readonly Site[]
  /**
   * The Spectre passphrase, stored inside this DEK-encrypted record so the
   * passkey unlock can auto-unlock the identity (no re-typing). Absent on
   * records written by older builds / devices where the user hasn't typed it.
   */
  passphrase?: string
}

/** The decrypted plaintext tree, never written to disk directly. */
export interface Vault {
  formatVersion: 1
  identities: readonly Identity[]
}

/** Validated decode/encode of the vault JSON, used at the storage boundary. */
const SiteSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  counter: Schema.Int,
  template: Schema.Int,
  purpose: Schema.Union([
    Schema.Literal('password'),
    Schema.Literal('login'),
    Schema.Literal('answer'),
  ]),
  answer: Schema.optional(Schema.String),
})

export const IdentitySchema = Schema.Struct({
  id: Schema.String,
  fullName: Schema.String,
  algorithm: Schema.Union([
    Schema.Literal(0),
    Schema.Literal(1),
    Schema.Literal(2),
    Schema.Literal(3),
  ]),
  sites: Schema.Array(SiteSchema),
  passphrase: Schema.optional(Schema.String),
})

export interface WrappedDeK {
  method: 'passkey' | 'recovery'
  /** HKDF salt used to derive the KEK from the PRF output / recovery code. */
  salt: ArrayBuffer
  /** For passkey wraps: the PRF-eval salt that produced this wrap's PRF output. */
  prfSalt?: ArrayBuffer
  /** For passkey wraps: the resident credential id (base64url) to target at unlock. */
  credId?: string
  /** AES-GCM IV used for the wrap. */
  iv: ArrayBuffer
  /** AES-GCM-wrapped DEK under the derived KEK. */
  wrapped: ArrayBuffer
}

/** Non-secret header record → 1 row in the envelope store, key "root". */
export interface Envelope {
  version: number
  deks: readonly WrappedDeK[]
  /** GS6: the trust-group id this device belongs to (v2 group envelope). */
  groupId?: string
  /** GS6: this device's ECDH public key (so the group can rekey to it). */
  devicePublic?: ArrayBuffer
  /** GS6: this device's ECDH private key, wrapped under its own unlock. */
  deviceSecret?: readonly WrappedDeK[]
}

/** The mirror's node identity (S6/M3): iroh SecretKey + the persisted vault doc. */
export interface NodeIdentity {
  secretKey: string
  docTicket?: string
  docId?: string
  authorKey?: string
}

/** The mirror's meta state (M3): which device is "this device". */
export interface MetaState {
  deviceId: string
  /** GS6: the group-admin device (the one that set up the vault) may revoke others. */
  isAdmin?: boolean
}

export interface Prefs {
  theme: 'dark'
  autoLockMinutes: number
}
