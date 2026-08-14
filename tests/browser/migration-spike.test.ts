import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import { vaultImpl } from '../../src/lib/vault/service.ts'
import {
  getAllRecords,
  readDeviceEnvelope,
  readMeta,
} from '../../src/lib/vault/storage.ts'
import {
  decryptBlob,
  encryptBlob,
  generateDek,
  kekFromPrf,
  wrapDek,
} from '../../src/lib/vault/crypto-dek.ts'
import { unwrapRecoveryDek } from '../../src/lib/sync/records.ts'
import { DB_NAME } from '../../src/lib/vault/schema.ts'
import type {
  Envelope,
  Identity,
  Vault,
  VaultBlob,
} from '../../src/lib/vault/schema.ts'
import type { SyncRecord } from '../../src/lib/sync/types.ts'

const run = <A, E>(e: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(e)

const RECOVERY = 'correct-horse-battery-staple'

const textEncoder = new TextEncoder()
const toBuf = (u: Uint8Array): ArrayBuffer => u.slice().buffer

const IDENTITY_A: Identity = {
  id: 'id-a',
  fullName: 'Ada',
  algorithm: 3,
  sites: [],
}
const IDENTITY_B: Identity = {
  id: 'id-b',
  fullName: 'Bob',
  algorithm: 3,
  sites: [],
}
const VAULT: Vault = { formatVersion: 1, identities: [IDENTITY_A, IDENTITY_B] }

const resetDb = (): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.addEventListener('success', () => resolve())
    req.addEventListener('error', () => reject(req.error))
  })

const openDb = (
  version: number,
  onUpgrade?: (db: IDBDatabase) => void,
): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version)
    if (onUpgrade) req.onupgradeneeded = () => onUpgrade(req.result)
    req.addEventListener('success', () => resolve(req.result))
    req.addEventListener('error', () => reject(req.error))
  })

const upgradeToV3 = (db: IDBDatabase): void => {
  for (const store of [
    'envelope',
    'vault',
    'prefs',
    'records',
    'node',
    'meta',
  ]) {
    if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
  }
}

const getStoreValue = async <T>(
  store: string,
  key: string,
): Promise<T | undefined> => {
  const db = await openDb(3)
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.addEventListener('success', () => {
      db.close()
      resolve(req.result as T | undefined)
    })
    req.addEventListener('error', () => reject(req.error))
  })
}

const getAllKeys = async (store: string): Promise<string[]> => {
  const db = await openDb(3)
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(store, 'readonly')
      .objectStore(store)
      .getAllKeys()
    req.addEventListener('success', () => {
      db.close()
      resolve(req.result as string[])
    })
    req.addEventListener('error', () => reject(req.error))
  })
}

/**
 * Build a genuine v2 state: the legacy `envelope` "root" + `vault` blob under a
 * DEK wrapped by the recovery code — exactly what a pre-upgrade vault looks like
 * after the DB opens at v3 (the v1 stores are kept for the migration to read).
 */
const buildV2Fixture = async (): Promise<{
  envelope: Envelope
  blob: VaultBlob
}> => {
  const db = await openDb(3, upgradeToV3)
  const { key: dek, raw } = await run(generateDek())
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await run(kekFromPrf(textEncoder.encode(RECOVERY), salt))
  const wrapped = await run(wrapDek(raw, kek))
  raw.fill(0)
  const envelope: Envelope = {
    version: 1,
    deks: [
      {
        method: 'recovery',
        salt: toBuf(salt),
        iv: toBuf(wrapped.iv),
        wrapped: toBuf(wrapped.wrapped),
      },
    ],
  }
  const { iv, ct } = await run(
    encryptBlob(dek, textEncoder.encode(JSON.stringify(VAULT))),
  )
  const blob: VaultBlob = { iv: toBuf(iv), ct: toBuf(ct) }
  const tx = db.transaction(['envelope', 'vault'], 'readwrite')
  tx.objectStore('envelope').put(envelope, 'root')
  tx.objectStore('vault').put(blob, 'ciphertext')
  await new Promise<void>((resolve, reject) => {
    tx.addEventListener('complete', () => resolve())
    tx.addEventListener('error', () => reject(tx.error))
  })
  db.close()
  return { envelope, blob }
}

const decryptRecord = async (
  record: SyncRecord,
  dek: CryptoKey,
): Promise<Identity> => {
  if (record.kind !== 'record') throw new Error('not a record')
  const pt = await run(
    decryptBlob(dek, new Uint8Array(record.iv), new Uint8Array(record.ct)),
  )
  return JSON.parse(new TextDecoder().decode(pt)) as Identity
}

describe('migration — v2 blob → v3 records', () => {
  beforeEach(async () => {
    await resetDb()
    Effect.runSync(vaultImpl.lock())
    await buildV2Fixture()
  })

  afterEach(() => {
    Effect.runSync(vaultImpl.lock())
  })

  test('migrate converts the v2 vault into decryptable per-identity records', async () => {
    const { vault } = await run(
      vaultImpl.migrate({ kind: 'recovery', code: RECOVERY }),
    )
    expect(vault.identities.map((i) => i.id).sort()).toEqual(['id-a', 'id-b'])

    // v3 mirror state: device envelope + meta present, legacy cleared.
    const meta = (await run(readMeta()))!
    expect(meta.migrated).toBe(true)
    const env = (await run(readDeviceEnvelope(meta.deviceId)))!
    expect(env.deks.length).toBe(1)
    expect(await getAllKeys('vault')).toEqual([])
    expect(await getAllKeys('envelope')).toEqual([meta.deviceId])

    // Records decrypt under the migrated DEK (writer = the device).
    const dek = await run(
      unwrapRecoveryDek(
        { v: 1, deviceId: meta.deviceId, deks: env.deks },
        RECOVERY,
      ),
    )
    const records = await run(getAllRecords())
    const identities = await Promise.all(
      records.map(async ([, r]) => decryptRecord(r, dek)),
    )
    expect(identities.map((i) => i.id).sort()).toEqual(['id-a', 'id-b'])
  })

  test('migration is idempotent and re-runnable', async () => {
    await run(vaultImpl.migrate({ kind: 'recovery', code: RECOVERY }))
    Effect.runSync(vaultImpl.lock())
    // The legacy data is gone, but a re-run must still not corrupt anything.
    await expect(
      run(vaultImpl.migrate({ kind: 'recovery', code: RECOVERY })),
    ).rejects.toThrow(/legacy/)
    // The migrated vault still unlocks.
    const unlocked = await run(vaultImpl.unlockWithRecovery(RECOVERY))
    expect(unlocked.identities.map((i) => i.id).sort()).toEqual([
      'id-a',
      'id-b',
    ])
  })

  test('a wrong recovery code fails before any re-encryption', async () => {
    await expect(
      run(vaultImpl.migrate({ kind: 'recovery', code: 'wrong-code-xxxxxxxx' })),
    ).rejects.toThrow(/unwrap|wrong/i)
    // Vault untouched: legacy data still present, no migration committed.
    expect(await getAllKeys('vault')).toEqual(['ciphertext'])
    expect(await getStoreValue('meta', 'state')).toBeUndefined()
  })

  test('after migration the vault unlocks by recovery code', async () => {
    await run(vaultImpl.migrate({ kind: 'recovery', code: RECOVERY }))
    Effect.runSync(vaultImpl.lock())
    const vault = await run(vaultImpl.unlockWithRecovery(RECOVERY))
    expect(vault.identities.map((i) => i.id).sort()).toEqual(['id-a', 'id-b'])
  })
})
