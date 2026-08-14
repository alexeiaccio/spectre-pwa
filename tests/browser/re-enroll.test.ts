import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { cdp } from 'vitest/browser'
import { vaultImpl } from '../../src/lib/vault/service.ts'
import { readDeviceEnvelope, readMeta } from '../../src/lib/vault/storage.ts'
import { DB_NAME } from '../../src/lib/vault/schema.ts'
import type { Envelope } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const RECOVERY = 'correct-horse-battery-staple'

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )

/** This device's envelope from the v3 mirror (meta → deviceId → envelope). */
const readDeviceEnvelopeNow = async (): Promise<Envelope> => {
  const meta = await run(readMeta())
  if (!meta?.deviceId) throw new Error('no device identity')
  const env = await run(readDeviceEnvelope(meta.deviceId))
  if (!env) throw new Error('no envelope for device')
  return env
}

/** Drop the whole DB so every test starts from a clean slate (real IndexedDB). */
const resetDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.addEventListener('success', () => resolve())
    req.addEventListener('error', () => reject(req.error))
    // onblocked: a just-closed connection is still tearing down — keep waiting;
    // onsuccess fires once it finishes closing (close() is asynchronous).
  })

/**
 * PRF-aware WebAuthn via a CDP virtual authenticator (playwright + chromium).
 * Replaces the old hand-rolled navigator.credentials mock: PRF eval works at
 * create() AND get() against the real browser WebAuthn stack.
 */
const installVirtualAuthenticator = async (): Promise<string> => {
  const client = await cdp()
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
        hasPrf: true,
      },
    },
  )
  return authenticatorId
}

const removeVirtualAuthenticator = async (
  authenticatorId: string,
): Promise<void> => {
  const client = await cdp()
  await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
}

describe('re-enroll', () => {
  let authenticatorId = ''

  beforeEach(async () => {
    await resetDb()
    Effect.runSync(vaultImpl.lock())
    authenticatorId = await installVirtualAuthenticator()
  })

  afterEach(async () => {
    await removeVirtualAuthenticator(authenticatorId)
  })

  test('setup → re-enroll passkey rotates DEK, keeps recovery + new passkey working', async () => {
    await run(vaultImpl.setup(RECOVERY))
    const envelope1 = await readDeviceEnvelopeNow()
    const passkey1 = envelope1.deks.find((d) => d.method === 'passkey')
    expect(passkey1, 'passkey record exists').toBeTruthy()

    // Replace the passkey: prove recovery, rotate DEK.
    await run(vaultImpl.reEnrollPasskey(RECOVERY))

    const envelope2 = await readDeviceEnvelopeNow()
    const passkey2 = envelope2.deks.find((d) => d.method === 'passkey')
    const rec2 = envelope2.deks.find((d) => d.method === 'recovery')
    expect(passkey2, 'new passkey record exists').toBeTruthy()
    expect(rec2, 'recovery record kept').toBeTruthy()
    expect(
      toHex(passkey2!.wrapped),
      'DEK rotated — new passkey wrap differs from old',
    ).not.toBe(toHex(passkey1!.wrapped))
    expect(envelope2.deks.filter((d) => d.method === 'passkey').length).toBe(1)

    // Recovery unlock still works against the new envelope.
    const viaRecovery = await run(vaultImpl.unlockWithRecovery(RECOVERY))
    expect(viaRecovery).toEqual({ formatVersion: 1, identities: [] })
  })

  test('re-enroll rejects a wrong recovery code', async () => {
    await run(vaultImpl.setup(RECOVERY))
    await run(vaultImpl.unlockWithRecovery(RECOVERY))
    await expect(() =>
      run(vaultImpl.reEnrollPasskey('wrong-code-xxxxxxxx')),
    ).rejects.toThrow(/unwrap/i)
  })

  test('re-enroll requires an active session', async () => {
    await expect(() =>
      run(vaultImpl.reEnrollPasskey(RECOVERY)),
    ).rejects.toThrow(/locked/i)
  })
})
