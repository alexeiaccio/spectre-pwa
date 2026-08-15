import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { cdp } from 'vitest/browser'
import { vaultImpl } from '../../src/lib/vault/service.ts'
import { DB_NAME } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const RECOVERY = 'correct-horse-battery-staple'

/** Drop the whole DB so every test starts from a clean slate (real IndexedDB). */
const resetDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.addEventListener('success', () => resolve())
    req.addEventListener('error', () => reject(req.error))
  })

/**
 * PRF-aware WebAuthn via a CDP virtual authenticator (playwright + chromium).
 * PRF eval works at create() AND get() against the real browser WebAuthn stack —
 * the only way to exercise the real passkey unlock path.
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

describe('passkey unlock (PRF salt persistence)', () => {
  let authenticatorId = ''

  beforeEach(async () => {
    await resetDb()
    Effect.runSync(vaultImpl.lock())
    authenticatorId = await installVirtualAuthenticator()
  })

  afterEach(async () => {
    await removeVirtualAuthenticator(authenticatorId)
  })

  test('setup → lock → passkey unlock opens the vault with the same PRF output', async () => {
    await run(vaultImpl.setup(RECOVERY))
    Effect.runSync(vaultImpl.lock())

    const vault = await run(vaultImpl.unlock())
    expect(vault).toEqual({ formatVersion: 1, identities: [] })
  })

  test('passkey unlock still works after a passkey re-enroll (rotated DEK + fresh salt)', async () => {
    await run(vaultImpl.setup(RECOVERY))
    await run(vaultImpl.unlockWithRecovery(RECOVERY))
    await run(vaultImpl.reEnrollPasskey(RECOVERY))
    Effect.runSync(vaultImpl.lock())

    const vault = await run(vaultImpl.unlock())
    expect(vault).toEqual({ formatVersion: 1, identities: [] })
  })

  test('recovery-only vault (no PRF context): code unlock works, passkey unlock blocked until re-enroll', async () => {
    await run(vaultImpl.setupRecoveryOnly(RECOVERY))
    Effect.runSync(vaultImpl.lock())

    await expect(run(vaultImpl.unlock())).rejects.toMatchObject({
      _tag: 'VaultUnlockedError',
    })

    const viaCode = await run(vaultImpl.unlockWithRecovery(RECOVERY))
    expect(viaCode).toEqual({ formatVersion: 1, identities: [] })

    // A passkey can be enrolled later from a PRF-capable context.
    await run(vaultImpl.reEnrollPasskey(RECOVERY))
    Effect.runSync(vaultImpl.lock())

    const viaPasskey = await run(vaultImpl.unlock())
    expect(viaPasskey).toEqual({ formatVersion: 1, identities: [] })
  })
})
