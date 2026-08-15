import { Context, Effect, Layer, Schema } from 'effect'
import type { SyncRecord } from '../sync/types.ts'
import {
  DB_NAME,
  ENVELOPE_STORE,
  META_STORE,
  NODE_STORE,
  PREFS_STORE,
  RECORDS_STORE,
  type Envelope,
  type MetaState,
  type NodeIdentity,
  type Prefs,
} from './schema.ts'

export class VaultStorageError extends Schema.TaggedError<VaultStorageError>()(
  'VaultStorageError',
  { message: Schema.String },
) {}

const open = (): Effect.Effect<IDBDatabase, VaultStorageError> =>
  Effect.callback<IDBDatabase, VaultStorageError>((resume) => {
    const req = indexedDB.open(DB_NAME, 3)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const store of [
        ENVELOPE_STORE,
        PREFS_STORE,
        RECORDS_STORE,
        NODE_STORE,
        META_STORE,
      ]) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store)
        }
      }
    }
    req.addEventListener('success', () => resume(Effect.succeed(req.result)))
    req.addEventListener('error', () =>
      resume(Effect.fail(new VaultStorageError({ message: 'open failed' }))),
    )
  })

function idb<T>(
  op: (db: IDBDatabase) => IDBRequest<T>,
): Effect.Effect<T, VaultStorageError> {
  return Effect.flatMap(open(), (db) =>
    Effect.callback<T, VaultStorageError>((resume) => {
      const req = op(db)
      req.addEventListener('success', () => {
        db.close()
        resume(Effect.succeed(req.result))
      })
      req.addEventListener('error', () => {
        db.close()
        resume(
          Effect.fail(new VaultStorageError({ message: 'request failed' })),
        )
      })
    }),
  )
}

/** Run a readwrite transaction over several stores; resolves on `complete`. */
function idbTx(
  stores: string[],
  run: (tx: IDBTransaction) => void,
): Effect.Effect<void, VaultStorageError> {
  return Effect.flatMap(open(), (db) =>
    Effect.callback<void, VaultStorageError>((resume) => {
      const tx = db.transaction(stores, 'readwrite')
      run(tx)
      tx.addEventListener('complete', () => {
        db.close()
        resume(Effect.void)
      })
      tx.addEventListener('error', () => {
        db.close()
        resume(
          Effect.fail(new VaultStorageError({ message: 'transaction failed' })),
        )
      })
      tx.addEventListener('abort', () => {
        db.close()
        resume(
          Effect.fail(
            new VaultStorageError({ message: 'transaction aborted' }),
          ),
        )
      })
    }),
  )
}

export const readPrefs = (): Effect.Effect<
  Prefs | undefined,
  VaultStorageError
> =>
  idb((db) =>
    db
      .transaction(PREFS_STORE, 'readonly')
      .objectStore(PREFS_STORE)
      .get('root'),
  )

export const writePrefs = (
  prefs: Prefs,
): Effect.Effect<void, VaultStorageError> =>
  idb((db) =>
    db
      .transaction(PREFS_STORE, 'readwrite')
      .objectStore(PREFS_STORE)
      .put(prefs, 'root'),
  ).pipe(Effect.as(undefined))

// --- v3 mirror helpers ---

export const readRecord = (
  identityId: string,
): Effect.Effect<SyncRecord | undefined, VaultStorageError> =>
  idb((db) =>
    db
      .transaction(RECORDS_STORE, 'readonly')
      .objectStore(RECORDS_STORE)
      .get(identityId),
  )

export const writeRecord = (
  identityId: string,
  record: SyncRecord,
): Effect.Effect<void, VaultStorageError> =>
  idbTx([RECORDS_STORE], (tx) => {
    tx.objectStore(RECORDS_STORE).put(record, identityId)
  })

export const writeRecords = (
  entries: Iterable<readonly [string, SyncRecord]>,
): Effect.Effect<void, VaultStorageError> =>
  idbTx([RECORDS_STORE], (tx) => {
    const store = tx.objectStore(RECORDS_STORE)
    for (const [id, record] of entries) store.put(record, id)
  })

export const getAllRecords = (): Effect.Effect<
  Array<readonly [string, SyncRecord]>,
  VaultStorageError
> =>
  Effect.flatMap(open(), (db) =>
    Effect.callback<Array<readonly [string, SyncRecord]>, VaultStorageError>(
      (resume) => {
        const store = db
          .transaction(RECORDS_STORE, 'readonly')
          .objectStore(RECORDS_STORE)
        const keysReq = store.getAllKeys()
        const valsReq = store.getAll()
        let keys: IDBValidKey[] = []
        let vals: SyncRecord[] = []
        const done = (): void => {
          db.close()
          resume(
            Effect.succeed(
              keys.map(
                (k, i) => [String(k), vals[i]] as readonly [string, SyncRecord],
              ),
            ),
          )
        }
        keysReq.addEventListener('success', () => {
          keys = keysReq.result
          if (keysReq.readyState === 'done' && valsReq.readyState === 'done')
            done()
        })
        valsReq.addEventListener('success', () => {
          vals = valsReq.result as SyncRecord[]
          if (keysReq.readyState === 'done' && valsReq.readyState === 'done')
            done()
        })
      },
    ),
  )

export const readDeviceEnvelope = (
  deviceId: string,
): Effect.Effect<Envelope | undefined, VaultStorageError> =>
  idb((db) =>
    db
      .transaction(ENVELOPE_STORE, 'readonly')
      .objectStore(ENVELOPE_STORE)
      .get(deviceId),
  )

export const writeDeviceEnvelope = (
  deviceId: string,
  envelope: Envelope,
): Effect.Effect<void, VaultStorageError> =>
  idbTx([ENVELOPE_STORE], (tx) => {
    tx.objectStore(ENVELOPE_STORE).put(envelope, deviceId)
  })

export const readMeta = (): Effect.Effect<
  MetaState | undefined,
  VaultStorageError
> =>
  idb((db) =>
    db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get('state'),
  )

export const writeMeta = (
  meta: MetaState,
): Effect.Effect<void, VaultStorageError> =>
  idbTx([META_STORE], (tx) => {
    tx.objectStore(META_STORE).put(meta, 'state')
  })

export const readNodeIdentity = (): Effect.Effect<
  NodeIdentity | undefined,
  VaultStorageError
> =>
  idb((db) =>
    db.transaction(NODE_STORE, 'readonly').objectStore(NODE_STORE).get('node'),
  )

export const writeNodeIdentity = (
  node: NodeIdentity,
): Effect.Effect<void, VaultStorageError> =>
  idbTx([NODE_STORE], (tx) => {
    tx.objectStore(NODE_STORE).put(node, 'node')
  })

// --- Service layer (Effect v4 function-style key) ---

export interface VaultStorageService {
  readPrefs: () => Effect.Effect<Prefs | undefined, VaultStorageError>
  writePrefs: (prefs: Prefs) => Effect.Effect<void, VaultStorageError>
  readRecord: (
    id: string,
  ) => Effect.Effect<SyncRecord | undefined, VaultStorageError>
  writeRecord: (
    id: string,
    record: SyncRecord,
  ) => Effect.Effect<void, VaultStorageError>
  writeRecords: (
    entries: Iterable<readonly [string, SyncRecord]>,
  ) => Effect.Effect<void, VaultStorageError>
  getAllRecords: () => Effect.Effect<
    Array<readonly [string, SyncRecord]>,
    VaultStorageError
  >
  readDeviceEnvelope: (
    deviceId: string,
  ) => Effect.Effect<Envelope | undefined, VaultStorageError>
  writeDeviceEnvelope: (
    deviceId: string,
    envelope: Envelope,
  ) => Effect.Effect<void, VaultStorageError>
  readMeta: () => Effect.Effect<MetaState | undefined, VaultStorageError>
  writeMeta: (meta: MetaState) => Effect.Effect<void, VaultStorageError>
  readNodeIdentity: () => Effect.Effect<
    NodeIdentity | undefined,
    VaultStorageError
  >
  writeNodeIdentity: (
    node: NodeIdentity,
  ) => Effect.Effect<void, VaultStorageError>
}

export const VaultStorageService = Context.Service<VaultStorageService>(
  'VaultStorageService',
)

export const VaultStorageLive = Layer.succeed(VaultStorageService, {
  readPrefs,
  writePrefs,
  readRecord,
  writeRecord,
  writeRecords,
  getAllRecords,
  readDeviceEnvelope,
  writeDeviceEnvelope,
  readMeta,
  writeMeta,
  readNodeIdentity,
  writeNodeIdentity,
})
