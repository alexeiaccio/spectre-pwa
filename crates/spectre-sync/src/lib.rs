//! Spectre Pocket Sync — minimal wasm wrapper over iroh + iroh-docs.
//!
//! S4 spike: prove two browser tabs can exchange one key-value record through
//! the n0 public relay. Memory-only stores (the browser build has no persistent
//! backend); persistence is the S6 follow-up.
//!
//! Value handling for the spike: records are written with `set_bytes` (so content
//! blobs flow over the wire) but values are read back through the entry **key**
//! (`prefix␀value`), avoiding the blobs content-read API which differs across
//! iroh-blobs versions. Reconciliation/LWW semantics are iroh-docs' own.

use iroh::{endpoint::presets, protocol::Router, Endpoint, SecretKey};
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::BlobsProtocol;
use iroh_docs::{Author, DocTicket, protocol::Docs, store::Query};
use iroh_gossip::net::Gossip;
use futures::StreamExt;
use n0_watcher::Watcher;
use wasm_bindgen::prelude::*;

/// Node handle kept alive by the JS side.
#[wasm_bindgen]
pub struct SyncNode {
    _router: Router,
    docs: Docs,
    node_id: String,
    endpoint: Endpoint,
    /// Held-open connections to peers (keeps them reachable across sync cycles and
    /// lets the docs engine reuse them via iroh's connection cache).
    _gossip_conns: std::cell::RefCell<Option<Vec<iroh::endpoint::Connection>>>,
}

#[wasm_bindgen]
impl SyncNode {
    /// Create a node bound to the n0 public relay + all protocols (blobs, gossip, docs).
    /// Uses a fresh random SecretKey, so the node id changes on every reload.
    pub async fn start() -> Result<SyncNode, JsError> {
        Self::start_inner(None).await
    }

    /// Create a node from a persisted SecretKey (32 bytes, hex-encoded). The same
    /// key always yields the same node id, so the node survives reloads.
    pub async fn start_with_secret_key(secret_key_hex: &str) -> Result<SyncNode, JsError> {
        if secret_key_hex.len() != 64 {
            return Err(JsError::new("secret key must be exactly 32 bytes, hex-encoded (64 chars)"));
        }
        let bytes = decode_hex(secret_key_hex).map_err(to_js)?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        Self::start_inner(Some(SecretKey::from_bytes(&key))).await
    }

    async fn start_inner(secret_key: Option<SecretKey>) -> Result<SyncNode, JsError> {
        let mut builder = Endpoint::builder(presets::N0).alpns(vec![
            iroh_blobs::ALPN.to_vec(),
            iroh_gossip::ALPN.to_vec(),
            iroh_docs::ALPN.to_vec(),
        ]);
        if let Some(sk) = secret_key {
            builder = builder.secret_key(sk);
        }
        let endpoint = builder.bind().await.map_err(to_js)?;
        let node_id = endpoint.id().to_string();
        let blobs = MemStore::default();
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let docs = Docs::memory()
            .spawn(endpoint.clone(), (*blobs).clone(), gossip.clone())
            .await
            .map_err(to_js)?;

        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&blobs, None))
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs.clone())
            .spawn();

        let node = SyncNode { _router: router, docs, node_id, endpoint, _gossip_conns: std::cell::RefCell::new(None) };
        node.ensure_online().await?;
        Ok(node)
    }

    /// Wait (bounded) until the endpoint has an *established* relay connection,
    /// so share tickets embed a dialable address and peers can reach us.
    async fn ensure_online(&self) -> Result<(), JsError> {
        let mut watcher = self.endpoint.home_relay_status();
        for _ in 0..120 {
            if watcher.get().iter().any(|s| s.is_connected()) {
                return Ok(());
            }
            if watcher.updated().await.is_err() {
                break;
            }
        }
        Err(JsError::new("relay connection not established after timeout"))
    }

    /// Export this node's SecretKey as hex (32 bytes). Call once, store in IndexedDB.
    pub fn export_secret_key(&self) -> Result<String, JsError> {
        Ok(hex(&self.endpoint.secret_key().to_bytes()))
    }

    /// Export the default author's 32 bytes as hex, so record edits keep a stable
    /// author identity across reloads (persist it and re-import on boot).
    pub async fn export_default_author(&self) -> Result<String, JsError> {
        let id = self.docs.author_default().await.map_err(to_js)?;
        let author = self
            .docs
            .author_export(id)
            .await
            .map_err(to_js)?
            .ok_or_else(|| JsError::new("default author not exportable"))?;
        Ok(hex(&author.to_bytes()))
    }

    /// Import a 32-byte author (hex) and make it the node's default author.
    pub async fn import_default_author(&self, author_hex: &str) -> Result<(), JsError> {
        if author_hex.len() != 64 {
            return Err(JsError::new("author must be exactly 32 bytes, hex-encoded (64 chars)"));
        }
        let bytes = decode_hex(author_hex).map_err(to_js)?;
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        let author = Author::from_bytes(&key);
        self.docs.author_import(author.clone()).await.map_err(to_js)?;
        self.docs.author_set_default(author.id()).await.map_err(to_js)?;
        Ok(())
    }

    /// Create a new empty doc, start sync on it, return the share ticket.
    pub async fn create_doc(&self) -> Result<String, JsError> {
        let doc = self.docs.create().await.map_err(to_js)?;
        // The creator must also be syncing the doc, or peers can't exchange records.
        doc.start_sync(vec![]).await.map_err(to_js)?;
        let ticket = doc
            .share(
                iroh_docs::api::protocol::ShareMode::Write,
                iroh_docs::api::protocol::AddrInfoOptions::RelayAndAddresses,
            )
            .await
            .map_err(to_js)?;
        Ok(ticket.to_string())
    }

    /// Import a doc from a share ticket, dial its peers over the docs ALPN using the
    /// relay address embedded in the ticket (no address-lookup dependency), hold the
    /// connections (iroh reuses them for the engine's own dial), then start syncing.
    pub async fn import_ticket(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        let doc = self.docs.import(ticket.clone()).await.map_err(to_js)?;
        let mut held = Vec::new();
        for peer in &ticket.nodes {
            if peer.relay_urls().next().is_some() || peer.ip_addrs().next().is_some() {
                if let Ok(conn) = self.endpoint.connect(peer.clone(), iroh_docs::ALPN).await {
                    held.push(conn);
                }
            }
        }
        self._gossip_conns.replace(Some(held));
        doc.start_sync(ticket.nodes.clone()).await.map_err(to_js)?;
        Ok(hex(&doc.id().to_bytes()))
    }

    /// Re-trigger sync with the ticket's peers on an already-imported doc (retry after boot).
    pub async fn resync(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        let doc = self.docs.open(ticket.capability.id()).await.map_err(to_js)?.ok_or_else(|| JsError::new("doc not open"))?;
        doc.start_sync(ticket.nodes.clone()).await.map_err(to_js)?;
        Ok("resynced".to_string())
    }

    /// Import + connect peers via relay + retry `start_sync` until a sync attempt lands.
    /// The engine's first dial can fail with "Failed to establish connection" (relay peer
    /// not yet reachable); retrying after the relay connection is established succeeds.
    pub async fn join_and_sync(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        let doc = self.docs.import(ticket.clone()).await.map_err(to_js)?;
        // Hold relay-bearing docs connections to every peer (no address-lookup dependency).
        let mut held = Vec::new();
        for peer in &ticket.nodes {
            if peer.relay_urls().next().is_some() || peer.ip_addrs().next().is_some() {
                if let Ok(conn) = self.endpoint.connect(peer.clone(), iroh_docs::ALPN).await {
                    held.push(conn);
                }
            }
        }
        self._gossip_conns.replace(Some(held));
        // Retry start_sync; the engine's dial needs the peer reachable.
        for _ in 0..8 {
            doc.start_sync(ticket.nodes.clone()).await.map_err(to_js)?;
            n0_future::time::sleep(std::time::Duration::from_millis(2000)).await;
        }
        Ok(hex(&doc.id().to_bytes()))
    }

    /// Inspect a ticket's node addresses (for diagnostics): relay URLs + direct addrs.
    pub fn ticket_info(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        let parts: Vec<String> = ticket
            .nodes
            .iter()
            .map(|a| {
                let relays: Vec<String> = a.relay_urls().map(|u| u.to_string()).collect();
                let direct: Vec<String> = a.ip_addrs().map(|sa| sa.to_string()).collect();
                format!("relays=[{}] direct=[{}]", relays.join(","), direct.join(","))
            })
            .collect();
        Ok(parts.join(" ; "))
    }

    /// Read the doc (namespace) id out of a ticket without importing or dialing.
    pub fn doc_id_from_ticket(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        Ok(hex(&ticket.capability.id().to_bytes()))
    }

    /// Dial a peer node id (hex) over the docs ALPN and keep the connection alive.
    /// Returns the remote endpoint id once connected (diagnostics for S4).
    pub async fn connect_docs(&self, node_id_hex: &str) -> Result<String, JsError> {
        let bytes = decode_hex(node_id_hex).map_err(to_js)?;
        let id: [u8; 32] = bytes.as_slice().try_into().map_err(to_js)?;
        let addr = iroh::EndpointAddr::new(iroh::PublicKey::from_bytes(&id).map_err(to_js)?);
        let conn = self.endpoint.connect(addr, iroh_docs::ALPN).await.map_err(to_js)?;
        let remote = conn.remote_id();
        let mut held = self._gossip_conns.borrow_mut();
        let vec = held.get_or_insert_with(Vec::new);
        vec.push(conn);
        Ok(remote.to_string())
    }

    /// Dial the peers from a ticket using their relay addresses (no address-lookup
    /// dependency) and hold the connections. Returns the number connected.
    pub async fn connect_peer(&self, ticket_str: &str) -> Result<String, JsError> {
        let ticket: DocTicket = ticket_str.parse().map_err(to_js)?;
        let mut ok = 0usize;
        let mut held = Vec::new();
        for peer in &ticket.nodes {
            if peer.relay_urls().next().is_some() || peer.ip_addrs().next().is_some() {
                match self.endpoint.connect(peer.clone(), iroh_docs::ALPN).await {
                    Ok(conn) => {
                        ok += 1;
                        held.push(conn);
                    }
                    Err(e) => return Err(JsError::new(&format!("dial failed: {e}"))),
                }
            }
        }
        self._gossip_conns.replace(Some(held));
        Ok(format!("connected {ok} peer(s)"))
    }

    /// Connection state for a remote node id (diagnostics).
    pub async fn remote_info(&self, node_id_hex: &str) -> Result<String, JsError> {
        let bytes = decode_hex(node_id_hex).map_err(to_js)?;
        let id: [u8; 32] = bytes.as_slice().try_into().map_err(to_js)?;
        let key = iroh::PublicKey::from_bytes(&id).map_err(to_js)?;
        match self.endpoint.remote_info(key.into()).await {
            Some(info) => Ok(format!("{:?}", info)),
            None => Ok("no-info".to_string()),
        }
    }

    /// Insert a key/value entry under the default author. Value travels in the
    /// entry key (key␀value); content bytes are still written to the blobs store.
    pub async fn set(&self, doc_id: &str, key: &str, value: &str) -> Result<(), JsError> {
        let doc = self.open(doc_id).await?;
        let author = self.docs.author_default().await.map_err(to_js)?;
        let mut k = key.as_bytes().to_vec();
        k.push(0);
        k.extend_from_slice(value.as_bytes());
        doc.set_bytes(author, k, value.as_bytes().to_vec()).await.map_err(to_js)?;
        Ok(())
    }

    /// Read the latest value for a key, or null.
    pub async fn get(&self, doc_id: &str, key: &str) -> Result<JsValue, JsError> {
        let doc = self.open(doc_id).await?;
        let mut prefix = key.as_bytes().to_vec();
        prefix.push(0);
        let entry = doc
            .get_one(Query::single_latest_per_key().key_prefix(prefix).build())
            .await
            .map_err(to_js)?;
        match entry {
            Some(e) => {
                let k = e.key();
                let sep = k.iter().position(|b| *b == 0);
                let v = match sep {
                    Some(i) => String::from_utf8_lossy(&k[i + 1..]).to_string(),
                    None => String::from_utf8_lossy(k).to_string(),
                };
                Ok(JsValue::from_str(&v))
            }
            None => Ok(JsValue::NULL),
        }
    }

    /// Subscribe to live events for one doc. Value inserts arrive as plain strings;
    /// sync lifecycle events arrive as "SYNC:<...>" so callers can distinguish them.
    pub async fn subscribe(&self, doc_id: &str, on_event: js_sys::Function) -> Result<(), JsError> {
        let doc = self.open(doc_id).await?;
        let mut events = doc.subscribe().await.map_err(to_js)?;
        let this = JsValue::UNDEFINED;
        wasm_bindgen_futures::spawn_local(async move {
            while let Some(ev) = events.next().await {
                let ev = match ev {
                    Ok(ev) => ev,
                    Err(_) => continue,
                };
                let value = match ev {
                    iroh_docs::engine::LiveEvent::InsertLocal { entry }
                    | iroh_docs::engine::LiveEvent::InsertRemote { entry, .. } => {
                        let k = entry.key();
                        let sep = k.iter().position(|b| *b == 0);
                        match sep {
                            Some(i) => Some(String::from_utf8_lossy(&k[i + 1..]).to_string()),
                            None => Some(String::from_utf8_lossy(k).to_string()),
                        }
                    }
                    iroh_docs::engine::LiveEvent::SyncFinished(ev) => {
                        let detail = match ev.result {
                            Ok(d) => format!("SYNC:ok sent={} recv={}", d.entries_sent, d.entries_received),
                            Err(e) => format!("SYNC:err {e}"),
                        };
                        Some(detail)
                    }
                    iroh_docs::engine::LiveEvent::NeighborUp(id) => {
                        Some(format!("NEIGHBOR_UP {}", id.fmt_short()))
                    }
                    _ => None,
                };
                if let Some(v) = value {
                    let _ = on_event.call1(&this, &JsValue::from_str(&v));
                }
            }
        });
        Ok(())
    }

    /// This node's public endpoint id (hex).
    pub fn node_id(&self) -> String {
        self.node_id.clone()
    }

    /// Home relay connection status (for diagnostics).
    pub fn relay_status(&self) -> String {
        self.endpoint
            .home_relay_status()
            .get()
            .iter()
            .map(|s| format!("{} connected={}", s.url(), s.is_connected()))
            .collect::<Vec<_>>()
            .join(" ; ")
    }

    /// Sync status for a doc: whether live sync is active.
    pub async fn sync_status(&self, doc_id: &str) -> Result<String, JsError> {
        let doc = self.open(doc_id).await?;
        let st = doc.status().await.map_err(to_js)?;
        Ok(format!("sync={} subscribers={} handles={}", st.sync, st.subscribers, st.handles))
    }

    /// Connected sync peers for a doc (node ids).
    pub async fn sync_peers(&self, doc_id: &str) -> Result<String, JsError> {
        let doc = self.open(doc_id).await?;
        let peers = doc.get_sync_peers().await.map_err(to_js)?;
        match peers {
            Some(ps) => Ok(ps.iter().map(|p| hex(p)).collect::<Vec<_>>().join(",")),
            None => Ok("(none)".to_string()),
        }
    }

    async fn open(&self, doc_id: &str) -> Result<iroh_docs::api::Doc, JsError> {
        let id = decode_hex(doc_id).map_err(to_js)?;
        let id: [u8; 32] = id.as_slice().try_into().map_err(to_js)?;
        self.docs
            .open(iroh_docs::NamespaceId::from(id))
            .await
            .map_err(to_js)?
            .ok_or_else(|| JsError::new("doc not open"))
    }
}

fn to_js(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn decode_hex(s: &str) -> Result<Vec<u8>, String> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}
