import { beforeEach, expect, test } from 'vitest'
import { Effect } from 'effect'
import { readPrefs, writePrefs } from '../../src/lib/vault/storage.ts'
import { DB_NAME } from '../../src/lib/vault/schema.ts'
import type { Prefs } from '../../src/lib/vault/schema.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const PREFS: Prefs = { theme: 'dark', autoLockMinutes: 5 }

/** Drop the whole DB so every test starts from a clean slate (real IndexedDB). */
const resetDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.addEventListener('success', () => resolve())
    req.addEventListener('error', () => reject(req.error))
    // onblocked: a just-closed connection is still tearing down — keep waiting;
    // onsuccess fires once it finishes closing (close() is asynchronous).
  })

beforeEach(async () => {
  await resetDb()
})

test('prefs roundtrip: write then read returns the same record', async () => {
  await run(writePrefs(PREFS))
  const got = await run(readPrefs())
  expect(got).toEqual(PREFS)
})

test('prefs read returns undefined before anything is written', async () => {
  const got = await run(readPrefs())
  expect(got).toBeUndefined()
})

test('prefs are isolated per database instance', async () => {
  await run(writePrefs(PREFS))
  // A fresh DB (new instance) has no stored prefs.
  await resetDb()
  const got = await run(readPrefs())
  expect(got).toBeUndefined()
})

test('writePrefs overwrites a previous value', async () => {
  await run(writePrefs({ theme: 'dark', autoLockMinutes: 2 }))
  await run(writePrefs(PREFS))
  const got = await run(readPrefs())
  expect(got).toEqual(PREFS)
})
