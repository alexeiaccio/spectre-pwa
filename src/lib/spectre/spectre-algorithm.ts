import { scrypt } from './scrypt.ts'
import {
  CHARACTER_CLASSES,
  DEFAULT_VERSION,
  SCOPES,
  TEMPLATES,
  type AlgorithmVersion,
  type Purpose,
} from './spectre-types.ts'

const encoder = new TextEncoder()

/** Copy into a fresh ArrayBuffer so TS 6.0's BufferSource accepts it. */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

export interface UserKey {
  key: Uint8Array
  version: AlgorithmVersion
}

export interface SiteKey {
  key: Uint8Array
  version: AlgorithmVersion
}

/**
 * Phase 1 — master key (per identity). scrypt over
 * `"com.lyndir.masterpassword" ‖ uint32BE(len) ‖ fullName`.
 * Version < 3 sizes the name field by characters, V3+ by bytes.
 */
export async function newUserKey(
  fullName: string,
  masterPassword: string,
  version: AlgorithmVersion = DEFAULT_VERSION,
): Promise<UserKey> {
  const scope = encoder.encode(SCOPES.authentication)
  const name = encoder.encode(fullName)
  const len = version < 3 ? fullName.length : name.length

  const salt = new Uint8Array(scope.length + 4 + name.length)
  const view = new DataView(salt.buffer)
  salt.set(scope, 0)
  view.setUint32(scope.length, len, false)
  salt.set(name, scope.length + 4)

  const key = await scrypt(encoder.encode(masterPassword), salt, 64)
  return { key, version }
}

/**
 * Build the HMAC salt for a site key: `scope ‖ uint32BE(len) ‖ siteName ‖ int32BE(counter)`
 * `[ ‖ uint32BE(len) ‖ context ]`. Len is chars if version<2, else bytes.
 */
export function siteKeySalt(
  version: AlgorithmVersion,
  siteName: string,
  keyCounter: number,
  keyPurpose: Purpose,
  keyContext: string | null,
): Uint8Array {
  const scope = encoder.encode(SCOPES[keyPurpose])
  const site = encoder.encode(siteName)
  const context = keyContext ? encoder.encode(keyContext) : null

  const len = version < 2 ? siteName.length : site.length
  const size =
    scope.length +
    4 + site.length +
    4 +
    (context ? 4 + context.length : 0)
  const salt = new Uint8Array(size)
  const view = new DataView(salt.buffer)
  let off = 0
  salt.set(scope, off); off += scope.length
  view.setUint32(off, len, false); off += 4
  salt.set(site, off); off += site.length
  view.setInt32(off, keyCounter, false); off += 4
  if (context) {
    view.setUint32(off, context.length, false); off += 4
    salt.set(context, off)
  }
  return salt
}

/**
 * Phase 2 — site key (per site / counter / purpose). HMAC-SHA-256 of the site salt.
 */
export async function newSiteKey(
  userKey: UserKey,
  siteName: string,
  keyCounter = 1,
  keyPurpose: Purpose = 'authentication',
  keyContext: string | null = null,
): Promise<SiteKey> {
  const salt = siteKeySalt(userKey.version, siteName, keyCounter, keyPurpose, keyContext)
  const key = await hmacSha256(userKey.key, salt)
  return { key, version: userKey.version }
}

/**
 * Render the password from a site key against a template.
 * V0 translates each site-key byte into a 16-bit big-endian number first.
 */
export function renderSiteKey(key: Uint8Array, version: AlgorithmVersion, resultType: number): string {
  const templates = TEMPLATES[resultType]
  if (!templates) throw new Error(`Unsupported result template: ${resultType}`)

  let bytes: Uint16Array | Uint8Array = key
  if (version === 0) {
    const v0 = new Uint16Array(key.length)
    for (let i = 0; i < v0.length; i++) {
      v0[i] = (key[i] > 127 ? 0x00ff : 0x0000) | (key[i] << 8)
    }
    bytes = v0
  }

  const template = templates[bytes[0] % templates.length]
  let out = ''
  for (let i = 0; i < template.length; i++) {
    const chars = CHARACTER_CLASSES[template[i]]
    out += chars[bytes[i + 1] % chars.length]
  }
  return out
}

async function hmacSha256(key: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', toBuf(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, toBuf(msg)))
}