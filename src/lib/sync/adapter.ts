// wasm-bindgen emits both a default export (init) and a named `SyncNode`;
// importing it as the default is the documented `--target web` pattern.
// oxlint-disable-next-line import/no-named-as-default
import initSync, { SyncNode } from '../spike/spectre_sync.js'
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

export interface SyncDocHandle {
  docId: string
  ticket: string
}

export interface SyncSubscribeHandlers {
  onValue: (key: string, value: string) => void
  onStatus: (status: string) => void
}

/** The iroh seam the S5 flows talk to. Implemented by the wasm adapter. */
export interface SyncAdapter {
  readonly experimental: boolean
  start(): Promise<void>
  createDoc(): Promise<SyncDocHandle>
  joinDoc(ticket: string): Promise<{ docId: string }>
  subscribe(docId: string, handlers: SyncSubscribeHandlers): Promise<void>
  get(docId: string, key: string): Promise<string | null>
  set(docId: string, key: string, value: string): Promise<void>
  syncStatus(docId: string): Promise<string>
}

export function createWasmSyncAdapter(): SyncAdapter {
  let node: SyncNode | null = null

  const ensure = async (): Promise<SyncNode> => {
    if (node) return node
    await initSync()
    node = await SyncNode.start()
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
  }
}

/** Lazily-created singleton; both the pairing section and the join flow share one node. */
let adapter: SyncAdapter | null = null
export const getSyncAdapter = (): SyncAdapter =>
  (adapter ??= createWasmSyncAdapter())
