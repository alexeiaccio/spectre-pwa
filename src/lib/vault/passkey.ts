import { Effect } from 'effect'

export class PasskeyError extends Error {
  readonly _tag = 'PasskeyError'
  constructor(message: string) {
    super(message)
  }
}

const bytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))

/** Copy to a fresh ArrayBuffer-backed buffer (TS 6.0 BufferSource). */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

/** Determinies rpId from the current origin's registrable domain suffix. */
export const rpId = (): string => location.hostname

const asPublicKey = (cred: Credential | null): PublicKeyCredential => {
  if (!cred || typeof (cred as PublicKeyCredential).getClientExtensionResults !== 'function') {
    throw new PasskeyError('credential result missing')
  }
  return cred as PublicKeyCredential
}

/**
 * Registration (first run): create a discoverable platform passkey that exposes PRF,
 * and return the PRF output fetched AT creation (bucket-4 providers like GPM).
 */
export const createPasskeyWithPrf = (salt: Uint8Array): Effect.Effect<{ credId: string; prfOutput: Uint8Array }, PasskeyError> =>
  Effect.tryPromise(async () => {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: toBuf(bytes(32)),
        rp: { id: rpId(), name: 'Spectre Pocket' },
        user: {
          id: toBuf(bytes(16)),
          name: 'local-vault',
          displayName: 'Spectre Pocket vault',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        extensions: { prf: { eval: { first: toBuf(salt) } } },
      },
    })
    const pk = asPublicKey(cred)
    const out = pk.getClientExtensionResults() as PrfResults
    if (!out.prf?.results?.first) throw new PasskeyError('PRF unsupported by this browser/authenticator')
    return {
      credId: pk.id,
      prfOutput: new Uint8Array(out.prf.results.first),
    }
  })

/**
 * Unlock: usernameless discoverable get() that returns the deterministic PRF output
 * for the chosen credential. The challenge is purely local — no server verifies it.
 */
export const getPrfOutput = (salt: Uint8Array): Effect.Effect<{ credId: string; prfOutput: Uint8Array }, PasskeyError> =>
  Effect.tryPromise(async () => {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(bytes(32)),
        rpId: rpId(),
        allowCredentials: [],
        userVerification: 'required',
        extensions: { prf: { eval: { first: toBuf(salt) } } },
      },
    })
    const pk = asPublicKey(cred)
    const out = pk.getClientExtensionResults() as PrfResults
    if (!out.prf?.results?.first) throw new PasskeyError('PRF not available on this device')
    return {
      credId: pk.id,
      prfOutput: new Uint8Array(out.prf.results.first),
    }
  }).pipe(Effect.mapError((e) => (e instanceof PasskeyError ? e : new PasskeyError('Authentication cancelled or failed'))))

interface PrfResults {
  prf?: {
    enabled?: boolean
    results?: {
      first?: ArrayBuffer
      second?: ArrayBuffer
    }
  }
}