export const DB_NAME = 'spectre-pocket'
export const DB_VERSION = 2

export const ENVELOPE_STORE = 'envelope'
export const VAULT_STORE = 'vault'
export const PREFS_STORE = 'prefs'

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
  sites: Site[]
}

/** The decrypted plaintext tree, never written to disk directly. */
export interface Vault {
  formatVersion: 1
  identities: Identity[]
}

export interface WrappedDeK {
  method: 'passkey' | 'recovery'
  /** HKDF salt used to derive the KEK from the PRF output / recovery code. */
  salt: ArrayBuffer
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

/** The single encrypted blob in the vault store, key "ciphertext". */
export interface VaultBlob {
  iv: ArrayBuffer
  ct: ArrayBuffer
}

export interface Prefs {
  theme: 'dark'
  autoLockMinutes: number
}