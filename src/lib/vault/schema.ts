import { Schema } from 'effect'

export const DB_NAME = 'spectre-pocket'
export const DB_VERSION = 3

export const ENVELOPE_STORE = 'envelope'
export const PREFS_STORE = 'prefs'
export const RECORDS_STORE = 'records'
export const NODE_STORE = 'node'
export const META_STORE = 'meta'

/** Algorithm version per spectre-types (2012:03=0, 2012:07=1, 2014:09=2, 2015:01=3). */
export type AlgorithmVersion = 0 | 1 | 2 | 3

export type SitePurpose = 'password' | 'login' | 'answer'

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
}

/** The decrypted plaintext tree, never written to disk directly. */
export interface Vault {
  formatVersion: 1
  identities: readonly Identity[]
}

/** Validated decode/encode of the vault JSON, used at the storage boundary. */
export const SiteSchema = Schema.Struct({
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
})

export const VaultSchema = Schema.Struct({
  formatVersion: Schema.Literal(1),
  identities: Schema.Array(IdentitySchema),
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
  deks: WrappedDeK[]
}

/** The mirror's node identity (S6/M3): iroh SecretKey + the persisted vault doc. */
export interface NodeIdentity {
  secretKey: string
  docTicket?: string
  docId?: string
  authorKey?: string
}

export const NodeIdentitySchema = Schema.Struct({
  secretKey: Schema.String,
  docTicket: Schema.optional(Schema.String),
  docId: Schema.optional(Schema.String),
  authorKey: Schema.optional(Schema.String),
})

/** The mirror's meta state (M3): which device is "this device". */
export interface MetaState {
  deviceId: string
}

export const MetaStateSchema = Schema.Struct({
  deviceId: Schema.String,
})

export interface Prefs {
  theme: 'dark'
  autoLockMinutes: number
}
