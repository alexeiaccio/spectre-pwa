import { Scrypt } from '@stablelib/scrypt'

const N = 32768
const R = 8
const P = 2

/**
 * RFC-7914 scrypt with the Spectre/Master Password parameters (N=32768, r=8, p=2).
 * Returns dkLen bytes. Non-blocking (chunks work so a 33 MiB working set does not
 * freeze the UI thread) — run in a worker for real UIs.
 */
export function scrypt(
  password: Uint8Array,
  salt: Uint8Array,
  dkLen: number,
): Promise<Uint8Array> {
  return new Scrypt(N, R, P).deriveKeyNonBlocking(password, salt, dkLen)
}
