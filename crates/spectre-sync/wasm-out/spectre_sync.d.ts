/* tslint:disable */
/* eslint-disable */
/**
 * The `ReadableStreamType` enum.
 *
 * *This API requires the following crate features to be activated: `ReadableStreamType`*
 */

export type ReadableStreamType = "bytes";

export class IntoUnderlyingByteSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableByteStreamController): Promise<any>;
    start(controller: ReadableByteStreamController): void;
    readonly autoAllocateChunkSize: number;
    readonly type: ReadableStreamType;
}

export class IntoUnderlyingSink {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    abort(reason: any): Promise<any>;
    close(): Promise<any>;
    write(chunk: any): Promise<any>;
}

export class IntoUnderlyingSource {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    cancel(): void;
    pull(controller: ReadableStreamDefaultController): Promise<any>;
}

/**
 * Node handle kept alive by the JS side.
 */
export class SyncNode {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Dial a peer node id (hex) over the docs ALPN and keep the connection alive.
     * Returns the remote endpoint id once connected (diagnostics for S4).
     */
    connect_docs(node_id_hex: string): Promise<string>;
    /**
     * Dial the peers from a ticket using their relay addresses (no address-lookup
     * dependency) and hold the connections. Returns the number connected.
     */
    connect_peer(ticket_str: string): Promise<string>;
    /**
     * Create a new empty doc, start sync on it, return the share ticket.
     */
    create_doc(): Promise<string>;
    /**
     * Read the doc (namespace) id out of a ticket without importing or dialing.
     */
    doc_id_from_ticket(ticket_str: string): string;
    /**
     * Export the default author's 32 bytes as hex, so record edits keep a stable
     * author identity across reloads (persist it and re-import on boot).
     */
    export_default_author(): Promise<string>;
    /**
     * Export this node's SecretKey as hex (32 bytes). Call once, store in IndexedDB.
     */
    export_secret_key(): string;
    /**
     * Read the latest value for a key, or null.
     */
    get(doc_id: string, key: string): Promise<any>;
    /**
     * Import a 32-byte author (hex) and make it the node's default author.
     */
    import_default_author(author_hex: string): Promise<void>;
    /**
     * Import a doc from a share ticket, dial its peers over the docs ALPN using the
     * relay address embedded in the ticket (no address-lookup dependency), hold the
     * connections (iroh reuses them for the engine's own dial), then start syncing.
     */
    import_ticket(ticket_str: string): Promise<string>;
    /**
     * Import + connect peers via relay + retry `start_sync` until a sync attempt lands.
     * The engine's first dial can fail with "Failed to establish connection" (relay peer
     * not yet reachable); retrying after the relay connection is established succeeds.
     */
    join_and_sync(ticket_str: string): Promise<string>;
    /**
     * This node's public endpoint id (hex).
     */
    node_id(): string;
    /**
     * Home relay connection status (for diagnostics).
     */
    relay_status(): string;
    /**
     * Connection state for a remote node id (diagnostics).
     */
    remote_info(node_id_hex: string): Promise<string>;
    /**
     * Re-trigger sync with the ticket's peers on an already-imported doc (retry after boot).
     */
    resync(ticket_str: string): Promise<string>;
    /**
     * Insert a key/value entry under the default author. Value travels in the
     * entry key (key␀value); content bytes are still written to the blobs store.
     */
    set(doc_id: string, key: string, value: string): Promise<void>;
    /**
     * Create a node bound to the n0 public relay + all protocols (blobs, gossip, docs).
     * Uses a fresh random SecretKey, so the node id changes on every reload.
     */
    static start(): Promise<SyncNode>;
    /**
     * Create a node from a persisted SecretKey (32 bytes, hex-encoded). The same
     * key always yields the same node id, so the node survives reloads.
     */
    static start_with_secret_key(secret_key_hex: string): Promise<SyncNode>;
    /**
     * Subscribe to live events for one doc. Value inserts arrive as plain strings;
     * sync lifecycle events arrive as "SYNC:<...>" so callers can distinguish them.
     */
    subscribe(doc_id: string, on_event: Function): Promise<void>;
    /**
     * Connected sync peers for a doc (node ids).
     */
    sync_peers(doc_id: string): Promise<string>;
    /**
     * Sync status for a doc: whether live sync is active.
     */
    sync_status(doc_id: string): Promise<string>;
    /**
     * Inspect a ticket's node addresses (for diagnostics): relay URLs + direct addrs.
     */
    ticket_info(ticket_str: string): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_syncnode_free: (a: number, b: number) => void;
    readonly syncnode_connect_docs: (a: number, b: number, c: number) => any;
    readonly syncnode_connect_peer: (a: number, b: number, c: number) => any;
    readonly syncnode_create_doc: (a: number) => any;
    readonly syncnode_doc_id_from_ticket: (a: number, b: number, c: number) => [number, number, number, number];
    readonly syncnode_export_default_author: (a: number) => any;
    readonly syncnode_export_secret_key: (a: number) => [number, number, number, number];
    readonly syncnode_get: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly syncnode_import_default_author: (a: number, b: number, c: number) => any;
    readonly syncnode_import_ticket: (a: number, b: number, c: number) => any;
    readonly syncnode_join_and_sync: (a: number, b: number, c: number) => any;
    readonly syncnode_node_id: (a: number) => [number, number];
    readonly syncnode_relay_status: (a: number) => [number, number];
    readonly syncnode_remote_info: (a: number, b: number, c: number) => any;
    readonly syncnode_resync: (a: number, b: number, c: number) => any;
    readonly syncnode_set: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly syncnode_start: () => any;
    readonly syncnode_start_with_secret_key: (a: number, b: number) => any;
    readonly syncnode_subscribe: (a: number, b: number, c: number, d: any) => any;
    readonly syncnode_sync_peers: (a: number, b: number, c: number) => any;
    readonly syncnode_sync_status: (a: number, b: number, c: number) => any;
    readonly syncnode_ticket_info: (a: number, b: number, c: number) => [number, number, number, number];
    readonly __wbg_intounderlyingsink_free: (a: number, b: number) => void;
    readonly intounderlyingsink_abort: (a: number, b: any) => any;
    readonly intounderlyingsink_close: (a: number) => any;
    readonly intounderlyingsink_write: (a: number, b: any) => any;
    readonly __wbg_intounderlyingbytesource_free: (a: number, b: number) => void;
    readonly __wbg_intounderlyingsource_free: (a: number, b: number) => void;
    readonly intounderlyingbytesource_autoAllocateChunkSize: (a: number) => number;
    readonly intounderlyingbytesource_cancel: (a: number) => void;
    readonly intounderlyingbytesource_pull: (a: number, b: any) => any;
    readonly intounderlyingbytesource_start: (a: number, b: any) => void;
    readonly intounderlyingbytesource_type: (a: number) => number;
    readonly intounderlyingsource_cancel: (a: number) => void;
    readonly intounderlyingsource_pull: (a: number, b: any) => any;
    readonly ring_core_0_17_14__bn_mul_mont: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h212a4ab003eb1cd1: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__ha488a54870679b56: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hc2a60248b29eb9e7: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h44f5a8a2e2d741a7: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h639e53a6e437cf0e: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h32f1caff51ae54e4: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h57c4011331ce49ce: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hb932bb66df9e2d58: (a: number, b: number) => void;
    readonly wasm_bindgen__convert__closures_____invoke__h845894347c7fc9c6: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
