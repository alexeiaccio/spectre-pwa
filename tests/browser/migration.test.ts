import { beforeEach, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  getAllRecords,
  readDeviceEnvelope,
  readMeta,
  readNodeIdentity,
  readPrefs,
} from '../../src/lib/vault/storage.ts'
import { DB_NAME } from '../../src/lib/vault/schema.ts'
import type { SyncRecord } from '../../src/lib/sync/types.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(
    '',
  )

/** Build the pre-refactor (v3) DB by hand: 5 stores, out-of-line keys. */
const seedV3Db = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of ['prefs', 'records', 'envelope', 'node', 'meta']) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store)
        }
      }
    }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(
        ['prefs', 'records', 'envelope', 'node', 'meta'],
        'readwrite',
      )
      tx.objectStore('prefs').put({ theme: 'dark', autoLockMinutes: 2 }, 'root')
      tx.objectStore('meta').put({ deviceId: 'dev-old' }, 'state')
      tx.objectStore('node').put({ secretKey: 'node-secret' }, 'node')
      tx.objectStore('envelope').put(
        {
          version: 1,
          deks: [
            {
              method: 'passkey',
              salt: new Uint8Array([1, 2]).buffer,
              prfSalt: new Uint8Array([3, 4]).buffer,
              credId: 'cred-old',
              iv: new Uint8Array([5, 6]).buffer,
              wrapped: new Uint8Array([7, 8]).buffer,
            },
            {
              method: 'recovery',
              salt: new Uint8Array([9, 10]).buffer,
              iv: new Uint8Array([11, 12]).buffer,
              wrapped: new Uint8Array([13, 14]).buffer,
            },
          ],
        },
        'dev-old',
      )
      tx.objectStore('records').put(
        {
          v: 2,
          kind: 'record',
          writer: 'writer-a',
          iv: new Uint8Array([15, 16]).buffer,
          ct: new Uint8Array([17, 18]).buffer,
        },
        'id-1',
      )
      tx.objectStore('records').put({ v: 2, kind: 'tombstone' }, 'id-2')
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  })

const dbVersion = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME)
    req.onsuccess = () => {
      const db = req.result
      const version = db.version
      db.close()
      resolve(version)
    }
    req.onerror = () => reject(req.error)
  })

const dropDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.addEventListener('success', () => resolve())
    req.addEventListener('error', () => reject(req.error))
  })

beforeEach(async () => {
  // Other browser test files run in parallel and share this DB; drop whatever
  // they left behind so the v3 seed below starts from a clean slate.
  await dropDb()
  await seedV3Db()
})

test('v3 mirror (out-of-line keys) migrates to v4 and reads back intact', async () => {
  // The first storage call opens with the new version and runs the migration.
  expect(await run(readPrefs())).toEqual({ theme: 'dark', autoLockMinutes: 2 })
  expect(await dbVersion(), 'upgrade runs the v4 migration').toBe(4)

  expect(await run(readMeta())).toEqual({ deviceId: 'dev-old' })
  expect(await run(readNodeIdentity())).toEqual({ secretKey: 'node-secret' })

  const envelope = await run(readDeviceEnvelope('dev-old'))
  expect(envelope).toBeTruthy()
  expect(envelope!.version).toBe(1)
  expect(envelope!.deks.map((d) => d.method)).toEqual(['passkey', 'recovery'])
  expect(toHex(envelope!.deks[0].salt)).toBe('0102')
  expect(toHex(envelope!.deks[0].prfSalt!)).toBe('0304')
  expect(envelope!.deks[0].credId).toBe('cred-old')
  expect(toHex(envelope!.deks[0].iv)).toBe('0506')
  expect(toHex(envelope!.deks[0].wrapped)).toBe('0708')
  expect(toHex(envelope!.deks[1].wrapped)).toBe('0d0e')

  const records = await run(getAllRecords())
  const byId = new Map(records)
  expect([...byId.keys()].sort()).toEqual(['id-1', 'id-2'])
  const live = byId.get('id-1') as SyncRecord
  expect(live.kind).toBe('record')
  expect(live.writer).toBe('writer-a')
  expect(toHex(live.iv)).toBe('0f10')
  expect(toHex(live.ct)).toBe('1112')
  expect(byId.get('id-2')).toEqual({ v: 2, kind: 'tombstone' })
})
