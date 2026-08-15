import { describe, expect, test } from 'vitest'
import { PasskeyError, isPrfUnavailable } from '../src/lib/vault/passkey.ts'

describe('isPrfUnavailable', () => {
  test('true for environmental PRF failures', () => {
    expect(
      isPrfUnavailable(
        new PasskeyError({
          message: 'PRF unsupported by this browser/authenticator',
        }),
      ),
    ).toBe(true)
    expect(
      isPrfUnavailable(
        new PasskeyError({ message: 'NotSupportedError: no such algorithm' }),
      ),
    ).toBe(true)
  })

  test('false for user cancels and unrelated errors', () => {
    expect(
      isPrfUnavailable(
        new PasskeyError({ message: 'Passkey creation cancelled' }),
      ),
    ).toBe(false)
    expect(
      isPrfUnavailable(
        new PasskeyError({ message: 'Authentication cancelled or failed' }),
      ),
    ).toBe(false)
    expect(isPrfUnavailable(new Error('boom'))).toBe(false)
    expect(isPrfUnavailable('nope')).toBe(false)
  })
})
