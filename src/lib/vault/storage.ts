import { Effect, Layer, Schema } from 'effect'
import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbQueryBuilder,
  IndexedDbTable,
  IndexedDbVersion,
} from '@effect/platform-browser'
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

const Buf = Schema.instanceOf(ArrayBuffer)

const WrappedDeKSchema = Schema.Struct({
  method: Schema.Union([Schema.Literal('passkey'), Schema.Literal('recovery')]),
  salt: Buf,
  prfSalt: Schema.optional(Buf),
  credId: Schema.optional(Schema.String),
  iv: Buf,
  wrapped: Buf,
})

// --- v4 rows: the out-of-line key moved into the row (`keyPath: 'key'`) so the
// typed query builder can target single rows with `equals`. ---

const EnvelopeSchema = Schema.Struct({
  key: Schema.String,
  version: Schema.Int,
  deks: Schema.Array(WrappedDeKSchema),
  groupId: Schema.optional(Schema.String),
  devicePublic: Schema.optional(Buf),
  deviceSecret: Schema.optional(Schema.Array(WrappedDeKSchema)),
})

const PrefsSchema = Schema.Struct({
  key: Schema.Literal('root'),
  theme: Schema.Literal('dark'),
  autoLockMinutes: Schema.Int,
})

const NodeSchema = Schema.Struct({
  key: Schema.Literal('node'),
  secretKey: Schema.String,
  docTicket: Schema.optional(Schema.String),
  docId: Schema.optional(Schema.String),
  authorKey: Schema.optional(Schema.String),
})

const MetaSchema = Schema.Struct({
  key: Schema.Literal('state'),
  deviceId: Schema.String,
  isAdmin: Schema.optional(Schema.Boolean),
})

/**
 * `SyncRecord` is a union, and an `IndexedDbTable` needs a flat struct, so the
 * union is stored flattened: a `record` row carries `writer`/`iv`/`ct`, a
 * `tombstone` row only the discriminator fields.
 */
const RecordsSchema = Schema.Struct({
  key: Schema.String,
  v: Schema.Literal(2),
  kind: Schema.Union([Schema.Literal('record'), Schema.Literal('tombstone')]),
  writer: Schema.optional(Schema.String),
  iv: Schema.optional(Buf),
  ct: Schema.optional(Buf),
})

type RecordsRow = Schema.Schema.Type<typeof RecordsSchema>

const recordToRow = (identityId: string, record: SyncRecord): RecordsRow =>
  record.kind === 'tombstone'
    ? { key: identityId, v: 2, kind: 'tombstone' }
    : {
        key: identityId,
        v: 2,
        kind: 'record',
        writer: record.writer,
        iv: record.iv,
        ct: record.ct,
      }

const rowToRecord = (row: RecordsRow): SyncRecord => {
  if (row.kind === 'tombstone') return { v: 2, kind: 'tombstone' }
  if (
    row.writer === undefined ||
    row.iv === undefined ||
    row.ct === undefined
  ) {
    throw new Error('corrupt record row')
  }
  return { v: 2, kind: 'record', writer: row.writer, iv: row.iv, ct: row.ct }
}

// --- v1–v3 rows: no in-row key, the key was passed out-of-line to `put`. ---

const EnvelopeSchemaV1 = Schema.Struct({
  version: Schema.Int,
  deks: Schema.Array(WrappedDeKSchema),
})

const PrefsSchemaV1 = Schema.Struct({
  theme: Schema.Literal('dark'),
  autoLockMinutes: Schema.Int,
})

const NodeSchemaV1 = Schema.Struct({
  secretKey: Schema.String,
  docTicket: Schema.optional(Schema.String),
  docId: Schema.optional(Schema.String),
  authorKey: Schema.optional(Schema.String),
})

const MetaSchemaV1 = Schema.Struct({
  deviceId: Schema.String,
})

const RecordsSchemaV1 = Schema.Struct({
  v: Schema.Literal(2),
  kind: Schema.Union([Schema.Literal('record'), Schema.Literal('tombstone')]),
  writer: Schema.optional(Schema.String),
  iv: Schema.optional(Buf),
  ct: Schema.optional(Buf),
})

const PrefsTableV1 = IndexedDbTable.make({
  name: PREFS_STORE,
  schema: PrefsSchemaV1,
})
const RecordsTableV1 = IndexedDbTable.make({
  name: RECORDS_STORE,
  schema: RecordsSchemaV1,
})
const EnvelopeTableV1 = IndexedDbTable.make({
  name: ENVELOPE_STORE,
  schema: EnvelopeSchemaV1,
})
const NodeTableV1 = IndexedDbTable.make({
  name: NODE_STORE,
  schema: NodeSchemaV1,
})
const MetaTableV1 = IndexedDbTable.make({
  name: META_STORE,
  schema: MetaSchemaV1,
})

const PrefsTable = IndexedDbTable.make({
  name: PREFS_STORE,
  schema: PrefsSchema,
  keyPath: 'key',
})
const RecordsTable = IndexedDbTable.make({
  name: RECORDS_STORE,
  schema: RecordsSchema,
  keyPath: 'key',
})
const EnvelopeTable = IndexedDbTable.make({
  name: ENVELOPE_STORE,
  schema: EnvelopeSchema,
  keyPath: 'key',
})
const NodeTable = IndexedDbTable.make({
  name: NODE_STORE,
  schema: NodeSchema,
  keyPath: 'key',
})
const MetaTable = IndexedDbTable.make({
  name: META_STORE,
  schema: MetaSchema,
  keyPath: 'key',
})

/**
 * Version chain: v1–v3 are the historical DB (5 out-of-line-key stores) — the
 * chain must be at least 4 long so DBs created by older builds (currently at
 * version 3) run the v4 migration instead of failing the open. v4 deletes and
 * recreates each store with `keyPath: 'key'`, copying the rows over.
 */
const V1 = IndexedDbVersion.make(
  PrefsTableV1,
  RecordsTableV1,
  EnvelopeTableV1,
  NodeTableV1,
  MetaTableV1,
)
const V2 = IndexedDbVersion.make(
  PrefsTableV1,
  RecordsTableV1,
  EnvelopeTableV1,
  NodeTableV1,
  MetaTableV1,
)
const V3 = IndexedDbVersion.make(
  PrefsTableV1,
  RecordsTableV1,
  EnvelopeTableV1,
  NodeTableV1,
  MetaTableV1,
)
const V4 = IndexedDbVersion.make(
  PrefsTable,
  RecordsTable,
  EnvelopeTable,
  NodeTable,
  MetaTable,
)

const SpectreDb = IndexedDbDatabase.make(
  V1,
  Effect.fn('vault.storage.initV1')(function* (api): Effect.fn.Return<
    void,
    IndexedDbDatabase.IndexedDbDatabaseError
  > {
    yield* api.createObjectStore(PREFS_STORE)
    yield* api.createObjectStore(RECORDS_STORE)
    yield* api.createObjectStore(ENVELOPE_STORE)
    yield* api.createObjectStore(NODE_STORE)
    yield* api.createObjectStore(META_STORE)
  }),
)
  .add(
    V2,
    Effect.fn('vault.storage.v2')(() => Effect.void),
  )
  .add(
    V3,
    Effect.fn('vault.storage.v3')(() => Effect.void),
  )
  .add(
    V4,
    Effect.fn('vault.storage.v4KeyPath')(function* (
      from: IndexedDbDatabase.Transaction<any>,
      to: IndexedDbDatabase.Transaction<any>,
    ): Effect.fn.Return<
      void,
      | IndexedDbQueryBuilder.IndexedDbQueryError
      | IndexedDbDatabase.IndexedDbDatabaseError
    > {
      for (const name of [
        PREFS_STORE,
        RECORDS_STORE,
        ENVELOPE_STORE,
        NODE_STORE,
        META_STORE,
      ] as const) {
        const rows = yield* from.from(name).select()
        yield* from.deleteObjectStore(name)
        yield* to.createObjectStore(name)
        yield* to.from(name).upsertAll(rows)
      }
    }),
  )

type QueryBuilder = Effect.Success<typeof SpectreDb.getQueryBuilder>

/** The composed DB layer: opens `spectre-pocket` from `window.indexedDB`. */
const VaultDbLayer = Layer.provide(
  SpectreDb.layer(DB_NAME),
  IndexedDb.layerWindow,
)

const withDb = <A, E>(
  use: (qb: QueryBuilder) => Effect.Effect<A, E>,
): Effect.Effect<
  A,
  | E
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> =>
  Effect.gen(function* () {
    const qb = yield* SpectreDb.getQueryBuilder
    return yield* use(qb)
  }).pipe(
    // `local: true` — one connection per operation, matching the previous
    // open-per-call behaviour of this module (the browser tests drop the whole
    // DB between cases, which requires no lingering connection).
    // oxlint-disable-next-line effecttsgo/strict-effect-provide
    Effect.provide(VaultDbLayer, { local: true }),
  )

export const readPrefs = Effect.fn('vault.storage.readPrefs')(
  function* (): Effect.fn.Return<
    Prefs | undefined,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    const rows = yield* withDb((qb) =>
      qb.from(PREFS_STORE).select().equals('root'),
    )
    const row = rows[0]
    return row
      ? { theme: row.theme, autoLockMinutes: row.autoLockMinutes }
      : undefined
  },
)

export const writePrefs = Effect.fn('vault.storage.writePrefs')(function* (
  prefs: Prefs,
): Effect.fn.Return<
  void,
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> {
  yield* withDb((qb) => qb.from(PREFS_STORE).upsert({ key: 'root', ...prefs }))
})

// --- v3 mirror helpers ---

export const writeRecord = Effect.fn('vault.storage.writeRecord')(function* (
  identityId: string,
  record: SyncRecord,
): Effect.fn.Return<
  void,
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> {
  yield* withDb((qb) =>
    qb.from(RECORDS_STORE).upsert(recordToRow(identityId, record)),
  )
})

export const writeRecords = Effect.fn('vault.storage.writeRecords')(function* (
  entries: Iterable<readonly [string, SyncRecord]>,
): Effect.fn.Return<
  void,
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> {
  const rows = Array.from(entries, ([id, record]) => recordToRow(id, record))
  yield* withDb((qb) => qb.from(RECORDS_STORE).upsertAll(rows))
})

export const getAllRecords = Effect.fn('vault.storage.getAllRecords')(
  function* (): Effect.fn.Return<
    Array<readonly [string, SyncRecord]>,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    const rows = yield* withDb((qb) => qb.from(RECORDS_STORE).select())
    return rows.map((row) => [row.key, rowToRecord(row)] as const)
  },
)

export const readDeviceEnvelope = Effect.fn('vault.storage.readDeviceEnvelope')(
  function* (
    deviceId: string,
  ): Effect.fn.Return<
    Envelope | undefined,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    const rows = yield* withDb((qb) =>
      qb.from(ENVELOPE_STORE).select().equals(deviceId),
    )
    const row = rows[0]
    return row
      ? {
          version: row.version,
          deks: row.deks,
          groupId: row.groupId,
          devicePublic: row.devicePublic,
          deviceSecret: row.deviceSecret,
        }
      : undefined
  },
)

export const writeDeviceEnvelope = Effect.fn(
  'vault.storage.writeDeviceEnvelope',
)(function* (
  deviceId: string,
  envelope: Envelope,
): Effect.fn.Return<
  void,
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> {
  yield* withDb((qb) =>
    qb.from(ENVELOPE_STORE).upsert({
      key: deviceId,
      version: envelope.version,
      deks: envelope.deks,
      groupId: envelope.groupId,
      devicePublic: envelope.devicePublic,
      deviceSecret: envelope.deviceSecret,
    }),
  )
})

export const readMeta = Effect.fn('vault.storage.readMeta')(
  function* (): Effect.fn.Return<
    MetaState | undefined,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    const rows = yield* withDb((qb) =>
      qb.from(META_STORE).select().equals('state'),
    )
    const row = rows[0]
    return row ? { deviceId: row.deviceId, isAdmin: row.isAdmin } : undefined
  },
)

export const writeMeta = Effect.fn('vault.storage.writeMeta')(function* (
  meta: MetaState,
): Effect.fn.Return<
  void,
  | IndexedDbQueryBuilder.IndexedDbQueryError
  | IndexedDbDatabase.IndexedDbDatabaseError
> {
  yield* withDb((qb) =>
    qb
      .from(META_STORE)
      .upsert({ key: 'state', deviceId: meta.deviceId, isAdmin: meta.isAdmin }),
  )
})

export const readNodeIdentity = Effect.fn('vault.storage.readNodeIdentity')(
  function* (): Effect.fn.Return<
    NodeIdentity | undefined,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    const rows = yield* withDb((qb) =>
      qb.from(NODE_STORE).select().equals('node'),
    )
    const row = rows[0]
    return row
      ? {
          secretKey: row.secretKey,
          docTicket: row.docTicket,
          docId: row.docId,
          authorKey: row.authorKey,
        }
      : undefined
  },
)

export const writeNodeIdentity = Effect.fn('vault.storage.writeNodeIdentity')(
  function* (
    node: NodeIdentity,
  ): Effect.fn.Return<
    void,
    | IndexedDbQueryBuilder.IndexedDbQueryError
    | IndexedDbDatabase.IndexedDbDatabaseError
  > {
    yield* withDb((qb) => qb.from(NODE_STORE).upsert({ key: 'node', ...node }))
  },
)
