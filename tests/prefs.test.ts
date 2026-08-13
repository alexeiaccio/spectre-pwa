import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Effect } from 'effect'
import { IDBFactory } from 'fake-indexeddb'
import { readPrefs, writePrefs } from '../src/lib/vault/storage.ts'
import type { Prefs } from '../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const PREFS: Prefs = { theme: 'dark', autoLockMinutes: 5 }

/** Fresh in-memory IDB per test. */
const installEnv = (): void => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).indexedDB = new IDBFactory()
}

test('prefs roundtrip: write then read returns the same record', async () => {
  installEnv()
  await run(writePrefs(PREFS))
  const got = await run(readPrefs())
  assert.deepEqual(got, PREFS)
})

test('prefs read returns undefined before anything is written', async () => {
  installEnv()
  const got = await run(readPrefs())
  assert.equal(got, undefined)
})

test('prefs are isolated per database instance', async () => {
  installEnv()
  await run(writePrefs(PREFS))
  // A fresh DB (new IDBFactory) has no stored prefs.
  ;(globalThis as { indexedDB: unknown }).indexedDB = new IDBFactory()
  const got = await run(readPrefs())
  assert.equal(got, undefined)
})

test('writePrefs overwrites a previous value', async () => {
  installEnv()
  await run(writePrefs({ theme: 'dark', autoLockMinutes: 2 }))
  await run(writePrefs(PREFS))
  const got = await run(readPrefs())
  assert.deepEqual(got, PREFS)
})
