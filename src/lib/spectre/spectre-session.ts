import { scrypt } from './scrypt.ts'
import { renderSiteKey, siteKeySalt } from './spectre-algorithm.ts'
import { SCOPES, type AlgorithmVersion, type Purpose } from './spectre-types.ts'
import type { Identity, Site } from '../vault/schema.ts'

const encoder = new TextEncoder()

/** Copy into a fresh ArrayBuffer so BufferSource accepts it. */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

/**
 * An unlocked Spectre identity session: the scrypt-derived master key held as a
 * non-extractable HMAC CryptoKey (never re-derivable per site). Raw bytes are
 * zeroized immediately after import. `unlock()` re-runs scrypt (~33 MiB working set).
 */
export class SpectreSession {
  readonly identity: Identity
  private masterKey: CryptoKey | null
  private readonly version: AlgorithmVersion

  private constructor(
    identity: Identity,
    masterKey: CryptoKey,
    version: AlgorithmVersion,
  ) {
    this.identity = identity
    this.masterKey = masterKey
    this.version = version
  }

  /** scrypt master key + import as non-extractable HMAC key, then zeroize the raw bytes. */
  static async unlock(
    identity: Identity,
    passphrase: string,
  ): Promise<SpectreSession> {
    const raw = await scrypt(
      encoder.encode(passphrase),
      userSalt(identity.fullName, identity.algorithm),
      64,
    )
    const masterKey = await crypto.subtle.importKey(
      'raw',
      toBuf(raw),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    raw.fill(0)
    return new SpectreSession(identity, masterKey, identity.algorithm)
  }

  /**
   * Derive the password/login/answer for one saved site. A single HMAC sign on the
   * held master key — no scrypt. Context is passed only for `answer` (the security
   * question, per Spectre); authentication and identification derive without context.
   */
  async password(site: Site): Promise<string> {
    const mk = this.masterKey
    if (!mk) throw new Error('session locked')
    const { purpose, context } = purposeOf(site.purpose, site.answer)
    const salt = siteKeySalt(
      this.version,
      site.name,
      site.counter,
      purpose,
      context,
    )
    const siteKey = new Uint8Array(
      await crypto.subtle.sign('HMAC', mk, toBuf(salt)),
    )
    return renderSiteKey(siteKey, this.version, site.template)
  }

  /** Drop the master key handle. The CryptoKey may be kept by the engine; this is hygiene, not a guarantee. */
  destroy(): void {
    this.masterKey = null
  }
}

/** scrypt user salt: scope ‖ uint32BE(len) ‖ fullName (len chars if version<3, else bytes). */
function userSalt(fullName: string, version: AlgorithmVersion): Uint8Array {
  const scope = encoder.encode(SCOPES.authentication)
  const name = encoder.encode(fullName)
  const len = version < 3 ? fullName.length : name.length
  const salt = new Uint8Array(scope.length + 4 + name.length)
  const view = new DataView(salt.buffer)
  salt.set(scope, 0)
  view.setUint32(scope.length, len, false)
  salt.set(name, scope.length + 4)
  return salt
}

function purposeOf(
  purpose: Site['purpose'],
  answer?: string,
): { purpose: Purpose; context: string | null } {
  switch (purpose) {
    case 'password':
      return { purpose: 'authentication', context: null }
    case 'login':
      return { purpose: 'identification', context: null }
    case 'answer':
      return { purpose: 'recovery', context: answer ?? null }
    default:
      // Exhaustive over the Site purpose union; unreachable for valid records.
      throw new Error('unknown site purpose')
  }
}
