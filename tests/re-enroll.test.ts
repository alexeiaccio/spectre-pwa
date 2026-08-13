import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Effect } from 'effect'
import { IDBFactory } from 'fake-indexeddb'
import { vaultImpl } from '../src/lib/vault/service.ts'
import { readEnvelope } from '../src/lib/vault/storage.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

/** Fresh in-memory IDB + deterministic PRF/credentials mock per test. */
const installEnv = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory()
  Object.defineProperty(globalThis, 'location', {
    value: { hostname: 'localhost', protocol: 'https:', origin: 'https://localhost' },
    configurable: true,
  })
  const credentials = {
    create: async () => fakeCredential(),
    get: async () => fakeCredential(),
  }
  Object.defineProperty(navigator, 'credentials', { value: credentials, configurable: true })
  vaultImpl.lock()
}

const PRF = crypto.getRandomValues(new Uint8Array(32))

const fakeCredential = (): PublicKeyCredential =>
  ({
    id: 'cred-' + Date.now(),
    type: 'public-key',
    getClientExtensionResults: () => ({
      prf: { enabled: true, results: { first: PRF.slice().buffer as ArrayBuffer } },
    }),
  }) as unknown as PublicKeyCredential

const RECOVERY = 'correct-horse-battery-staple'

test('setup → re-enroll passkey rotates DEK, keeps recovery + new passkey working', async () => {
  installEnv()

  const created = await run(vaultImpl.setup(RECOVERY))
  const envelope1 = await run(readEnvelope())
  assert.ok(envelope1, 'envelope written')
  const passkey1 = envelope1!.deks.find((d) => d.method === 'passkey')
  assert.ok(passkey1, 'passkey record exists')

  // Replace the passkey: prove recovery, rotate DEK.
  await run(vaultImpl.reEnrollPasskey(RECOVERY))

  const envelope2 = await run(readEnvelope())
  assert.ok(envelope2, 'envelope rewritten')
  const passkey2 = envelope2!.deks.find((d) => d.method === 'passkey')
  const rec2 = envelope2!.deks.find((d) => d.method === 'recovery')
  assert.ok(passkey2, 'new passkey record exists')
  assert.ok(rec2, 'recovery record kept')
  assert.notEqual(
    Buffer.from(passkey2!.wrapped as ArrayBuffer).toString('hex'),
    Buffer.from(passkey1!.wrapped as ArrayBuffer).toString('hex'),
    'DEK rotated — new passkey wrap differs from old',
  )
  assert.equal(envelope2!.deks.filter((d) => d.method === 'passkey').length, 1, 'old passkey wrap replaced, not appended')

  // Recovery unlock still works against the new envelope.
  const viaRecovery = await run(vaultImpl.unlockWithRecovery(RECOVERY))
  assert.deepEqual(viaRecovery, { formatVersion: 1, identities: [] })
})

test('re-enroll rejects a wrong recovery code', async () => {
  installEnv()

  await run(vaultImpl.setup(RECOVERY))
  await run(vaultImpl.unlockWithRecovery(RECOVERY))
  await assert.rejects(() => run(vaultImpl.reEnrollPasskey('wrong-code-xxxxxxxx')), /auth|unwrapp|error/i)
})

test('re-enroll requires an active session', async () => {
  installEnv()
  await assert.rejects(() => run(vaultImpl.reEnrollPasskey(RECOVERY)), /locked/i)
})