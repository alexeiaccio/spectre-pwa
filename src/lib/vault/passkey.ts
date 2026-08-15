import { Data, Effect } from 'effect'

export class PasskeyError extends Data.TaggedError('PasskeyError')<{
  message?: string
}> {}

const bytes = (n: number): Uint8Array =>
  crypto.getRandomValues(new Uint8Array(n))

/** Copy to a fresh ArrayBuffer-backed buffer. */
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

/** Determinies rpId from the current origin's registrable domain suffix. */
const rpId = (): string => location.hostname

/** `Effect.tryPromise` wraps thrown errors in UnknownError; unwrap the cause. */
const causeOf = (e: unknown): unknown => {
  if (e instanceof Error && e.cause !== undefined) return e.cause
  return e
}

const describe = (e: unknown): string => {
  if (e instanceof DOMException) return `${e.name}: ${e.message}`
  if (e instanceof Error) return `${e.name}: ${e.message}`
  return String(e)
}

/** Map the UnknownError wrapper back to a typed PasskeyError, keeping cancel distinct. */
const mapPasskeyError =
  (cancelledMessage: string) =>
  (e: unknown): PasskeyError => {
    const cause = causeOf(e)
    if (cause instanceof PasskeyError) return cause
    if (cause instanceof DOMException && cause.name === 'NotAllowedError')
      return new PasskeyError({ message: cancelledMessage })
    return new PasskeyError({ message: describe(cause) })
  }

/**
 * True when the failure is environmental (no PRF-capable platform
 * authenticator), not a user cancel. These errors are safe to auto-fallback on.
 */
export const isPrfUnavailable = (e: unknown): boolean => {
  if (!(e instanceof PasskeyError)) return false
  return /PRF|NotSupportedError|SecurityError/i.test(e.message ?? '')
}

const asPublicKey = (cred: Credential | null): PublicKeyCredential => {
  if (!cred) throw new PasskeyError({ message: 'credential result missing' })
  // The browser API only types the base `Credential`; PRF-capable credentials
  // expose getClientExtensionResults, which is runtime-checked below.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const pk = cred as PublicKeyCredential
  if (typeof pk.getClientExtensionResults !== 'function')
    throw new PasskeyError({ message: 'credential result missing' })
  return pk
}

/** PRF output (the 32-byte evaluator result) from a credential's extension results. */
const prfOutputOf = (
  out: AuthenticationExtensionsClientOutputs,
): Uint8Array | undefined => {
  const first = out.prf?.results?.first
  if (first === undefined) return undefined
  return first instanceof ArrayBuffer
    ? new Uint8Array(first)
    : new Uint8Array(
        first.buffer.slice(
          first.byteOffset,
          first.byteOffset + first.byteLength,
        ),
      )
}

/**
 * Registration (first run): create a discoverable platform passkey that exposes PRF,
 * and return the PRF output fetched AT creation (bucket-4 providers like GPM).
 * Errors are mapped to PasskeyError; cancel and PRF-unavailability stay distinct
 * so the caller can offer a recovery-code-only fallback.
 */
export const createPasskeyWithPrf = (
  salt: Uint8Array,
): Effect.Effect<{ credId: string; prfOutput: Uint8Array }, PasskeyError> =>
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
    const prfOutput = prfOutputOf(pk.getClientExtensionResults())
    if (!prfOutput)
      throw new PasskeyError({
        message: 'PRF unsupported by this browser/authenticator',
      })
    return { credId: pk.id, prfOutput }
  }).pipe(Effect.mapError(mapPasskeyError('Passkey creation cancelled')))

/**
 * Unlock: usernameless discoverable get() that returns the deterministic PRF output
 * for the chosen credential. Scoped to `credId` (base64url) so a stale credential
 * left behind by a re-enroll is never selected. The challenge is purely local.
 */
export const getPrfOutput = (
  salt: Uint8Array,
  credId: string,
): Effect.Effect<{ credId: string; prfOutput: Uint8Array }, PasskeyError> =>
  Effect.tryPromise(async () => {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: toBuf(bytes(32)),
        rpId: rpId(),
        allowCredentials: [{ type: 'public-key', id: credIdToBytes(credId) }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: toBuf(salt) } } },
      },
    })
    const pk = asPublicKey(cred)
    const prfOutput = prfOutputOf(pk.getClientExtensionResults())
    if (!prfOutput)
      throw new PasskeyError({ message: 'PRF not available on this device' })
    return { credId: pk.id, prfOutput }
  }).pipe(
    Effect.mapError(mapPasskeyError('Authentication cancelled or failed')),
  )

/** base64url credential id (Credential.id) → bytes for allowCredentials. */
const credIdToBytes = (credId: string): ArrayBuffer => {
  const b64 = credId.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}
