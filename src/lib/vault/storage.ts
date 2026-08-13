import { Context, Effect, Layer } from 'effect'
import { DB_NAME, ENVELOPE_STORE, VAULT_STORE, PREFS_STORE, type Envelope, type Prefs, type VaultBlob } from './schema.ts'

export class VaultStorageError extends Error {
  readonly _tag = 'VaultStorageError'
  constructor(message: string) {
    super(message)
  }
}

const open = (): Effect.Effect<IDBDatabase, VaultStorageError> =>
  Effect.tryPromise(
    () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(ENVELOPE_STORE)) {
            db.createObjectStore(ENVELOPE_STORE)
          }
          if (!db.objectStoreNames.contains(VAULT_STORE)) {
            db.createObjectStore(VAULT_STORE)
          }
          if (!db.objectStoreNames.contains(PREFS_STORE)) {
            db.createObjectStore(PREFS_STORE)
          }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  ).pipe(Effect.mapError(() => new VaultStorageError('open failed')))

function idb<T>(op: (db: IDBDatabase) => IDBRequest<T>): Effect.Effect<T, VaultStorageError> {
  return Effect.flatMap(open(), (db) =>
    Effect.tryPromise(
      () =>
        new Promise<T>((resolve, reject) => {
          const req = op(db)
          req.onsuccess = () => resolve(req.result)
          req.onerror = () => reject(req.error)
        }).finally(() => db.close()),
    ).pipe(Effect.mapError(() => new VaultStorageError('request failed'))),
  )
}

export const readEnvelope = (): Effect.Effect<Envelope | undefined, VaultStorageError> =>
  idb((db) => db.transaction(ENVELOPE_STORE, 'readonly').objectStore(ENVELOPE_STORE).get('root'))

export const writeEnvelope = (envelope: Envelope): Effect.Effect<void, VaultStorageError> =>
  idb((db) => db.transaction(ENVELOPE_STORE, 'readwrite').objectStore(ENVELOPE_STORE).put(envelope, 'root')).pipe(
    Effect.as(undefined),
  )

export const readVaultBlob = (): Effect.Effect<VaultBlob | undefined, VaultStorageError> =>
  idb((db) => db.transaction(VAULT_STORE, 'readonly').objectStore(VAULT_STORE).get('ciphertext'))

export const writeVaultBlob = (blob: VaultBlob): Effect.Effect<void, VaultStorageError> =>
  idb((db) => db.transaction(VAULT_STORE, 'readwrite').objectStore(VAULT_STORE).put(blob, 'ciphertext')).pipe(
    Effect.as(undefined),
  )

export const readPrefs = (): Effect.Effect<Prefs | undefined, VaultStorageError> =>
  idb((db) => db.transaction(PREFS_STORE, 'readonly').objectStore(PREFS_STORE).get('root'))

export const writePrefs = (prefs: Prefs): Effect.Effect<void, VaultStorageError> =>
  idb((db) => db.transaction(PREFS_STORE, 'readwrite').objectStore(PREFS_STORE).put(prefs, 'root')).pipe(
    Effect.as(undefined),
  )

// --- Service layer (Effect v4 function-style key) ---

export interface VaultStorageService {
  readEnvelope: () => Effect.Effect<Envelope | undefined, VaultStorageError>
  writeEnvelope: (envelope: Envelope) => Effect.Effect<void, VaultStorageError>
  readVaultBlob: () => Effect.Effect<VaultBlob | undefined, VaultStorageError>
  writeVaultBlob: (blob: VaultBlob) => Effect.Effect<void, VaultStorageError>
  readPrefs: () => Effect.Effect<Prefs | undefined, VaultStorageError>
  writePrefs: (prefs: Prefs) => Effect.Effect<void, VaultStorageError>
}

export const VaultStorageService = Context.Service<VaultStorageService>('VaultStorageService')

export const VaultStorageLive = Layer.succeed(VaultStorageService, {
  readEnvelope,
  writeEnvelope,
  readVaultBlob,
  writeVaultBlob,
  readPrefs,
  writePrefs,
})