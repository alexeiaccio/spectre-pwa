import { Effect } from 'effect'
// wasm-bindgen emits both a default export (init) and a named `SyncNode`;
// importing it as the default is the documented `--target web` pattern.
// oxlint-disable-next-line import/no-named-as-default
import initSync, { SyncNode } from '../spike/spectre_sync.js'
import { readNodeIdentity, writeNodeIdentity } from '../vault/storage.ts'
import { Schema } from 'effect'

/**
 * S7 verdict: browser-to-browser docs sync over the n0 relay is experimental in
 * iroh-docs 0.101 wasm — the wrapper-side fixes are in (ALPN advertisement,
 * relay-address dialing, relay-up wait, retry) but the engine's sync dial is
 * nondeterministic. The join flow surfaces this and never hard-fails.
 */
export const SYNC_EXPERIMENTAL = true

export class SyncUnavailableError extends Schema.TaggedError<SyncUnavailableError>()(
  'SyncUnavailableError',
  { message: Schema.String },
) {}

interface SyncDocHandle {
  docId: string
  ticket: string
}

interface SyncSubscribeHandlers {
  onValue: (key: string, value: string) => void
  onStatus: (status: string) => void
}

/** The iroh seam the S5 flows talk to. Implemented by the wasm adapter. */
export interface SyncAdapter {
  readonly experimental: boolean
  start(): Promise<void>
  createDoc(): Promise<SyncDocHandle>
  joinDoc(ticket: string): Promise<{ docId: string }>
  /** Read the doc id out of a ticket without importing or dialing. */
  docIdFromTicket(ticket: string): string
  subscribe(docId: string, handlers: SyncSubscribeHandlers): Promise<void>
  get(docId: string, key: string): Promise<string | null>
  set(docId: string, key: string, value: string): Promise<void>
  syncStatus(docId: string): Promise<string>
  /** Home relay connection status (diagnostics). */
  relayStatus(): Promise<string>
}

function createWasmSyncAdapter(): SyncAdapter {
  let node: SyncNode | null = null

  const ensure = async (): Promise<SyncNode> => {
    if (node) return node
    await initSync()
    const persisted = await Effect.runPromise(readNodeIdentity())
    if (persisted?.secretKey) {
      // Stable node id across reloads (M6/M9).
      node = await SyncNode.start_with_secret_key(persisted.secretKey)
      if (persisted.authorKey) {
        try {
          await node.import_default_author(persisted.authorKey)
        } catch {
          // best-effort: a fresh author is minted anyway
        }
      }
    } else {
      node = await SyncNode.start()
      // Persist the node identity so a reload keeps the same id (M6/M9).
      let authorKey: string | undefined
      try {
        authorKey = await node.export_default_author()
      } catch {
        authorKey = undefined
      }
      await Effect.runPromise(
        writeNodeIdentity({
          secretKey: node.export_secret_key(),
          authorKey,
        }),
      )
    }
    return node
  }

  return {
    experimental: SYNC_EXPERIMENTAL,
    start: async () => {
      await ensure()
    },
    createDoc: async () => {
      const n = await ensure()
      const ticket = await n.create_doc()
      return { docId: n.doc_id_from_ticket(ticket), ticket }
    },
    joinDoc: async (ticket) => {
      const n = await ensure()
      const docId = await n.join_and_sync(ticket)
      return { docId }
    },
    docIdFromTicket: (ticket) => {
      if (!node) throw new SyncUnavailableError({ message: 'node not started' })
      return node.doc_id_from_ticket(ticket)
    },
    subscribe: async (docId, handlers) => {
      const n = await ensure()
      await n.subscribe(docId, (v: unknown) => {
        const s = String(v)
        if (s.startsWith('SYNC:') || s.startsWith('NEIGHBOR_UP:')) {
          handlers.onStatus(s)
        } else {
          handlers.onValue('', s)
        }
      })
    },
    get: async (docId, key) => {
      const n = await ensure()
      const v = await n.get(docId, key)
      return v == null ? null : String(v)
    },
    set: async (docId, key, value) => {
      const n = await ensure()
      await n.set(docId, key, value)
    },
    syncStatus: async (docId) => {
      const n = await ensure()
      return n.sync_status(docId)
    },
    relayStatus: async () => {
      const n = await ensure()
      return n.relay_status()
    },
  }
}

/** Lazily-created singleton; both the pairing section and the join flow share one node. */
let adapter: SyncAdapter | null = null
export const getSyncAdapter = (): SyncAdapter =>
  (adapter ??= createWasmSyncAdapter())

/** Persist the vault doc capability (ticket + doc id) in the mirror (M6/M8). */
export const persistDoc = async (
  ticket: string,
  docId: string,
): Promise<void> => {
  // Starting the node persists the SecretKey first (if not already), so the
  // doc capability always lands alongside a stable node identity.
  await getSyncAdapter().start()
  const node = (await Effect.runPromise(readNodeIdentity())) ?? {
    secretKey: '',
  }
  await Effect.runPromise(
    writeNodeIdentity({ ...node, docTicket: ticket, docId }),
  )
}
