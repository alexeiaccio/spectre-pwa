# T2 Prototype — Vault storage engine and schema

Status: prototype for reaction · 2026-08-10
Depends on: T1 (closed) — envelope encryption: random per-vault **DEK** (data encryption key), wrapped under each passkey's PRF output **and** a typed recovery code; HKDF → AES-GCM.

## Decision framed

Three candidate shapes for the encrypted vault:

| | A. Whole-vault blob | B. Per-record AEAD | C. Per-identity blob |
|---|---|---|---|
| At rest | one AES-GCM blob of the entire tree (envelope + one ciphertext) | each identity + each site individually encrypted | one blob per identity |
| Write cost | rewrite whole blob on any change | single record write | rewrite one identity |
| Wipe | drop one blob object | drop N records | drop identity blob |
| Complexity | lowest — one encrypt/decrypt, atomic | highest — per-record IV/nonce lifecycle | middle |
| Fits tiny personal vault | ✅ trivially (≤ a few KB) | overkill | acceptable |

**Recommended: A — whole-vault blob.** The vault is tiny, personal, single-user, and editing is rare. One atomic blob gives a trivial "unlocked = decrypted tree in memory, lock = drop it" model, no per-record nonce bookkeeping, and the smallest attack surface. Rewriting on each change costs nothing at this size (a few KB).

## Crypto layout (from T1)

```
DEK = 32 random bytes, generated once at first setup (crypto.getRandomValues)
vaultKey_read/write are NOT derived per session later:
  - unlock: passkey.get({prf}) → 32B prfOut → HKDF-SHA256 → KEK_k
             DEK = AES-GCM-decrypt(wrappedDEK_k, KEK_k)
  - recovery: KEK_r = HKDF(recoveryCode) ; DEK = AES-GCM-decrypt(wrappedDEK_r, KEK_r)
  - vault blob: AES-GCM encrypt(DEK, plaintextTreeJSON)
```

Two wrappings of the same DEK (passkey + recovery). DEK lives only while unlocked; wiped on lock.

## IndexedDB vs OPFS

**Recommend: IndexedDB.** OPFS buys synchronous file handles and plays for large binary assets; this vault is tiny structured JSON that must be freshly decrypted on every unlock anyway. IDB is transactional, async (WebCrypto-compatible), fights well with a memory-cached decrypted tree, and needs no storage-persist ceremony beyond `navigator.storage.persist()`. OPFS adds zero value here and complicates the read-modify-write (mutex via `navigator.locks`).

## IndexedDB schema (v1)

DB name: `spectre-pocket` · version 1

### Object store `envelope` → single record key `"root"`
```
{
  version: 1,                 // schema version
  blobIv: ByteString,         // nonce for the blob below
  deks: [                     // every way the DEK is wrapped
    { method: 'passkey', salt: ByteString, wrapped: ByteString },   // +1 per enrolled passkey
    { method: 'recovery', salt: ByteString, wrapped: ByteString },
  ],
}
```

### Object store `vault` → single record key `"ciphertext"`
```
{
  iv: ByteString,             // AES-GCM nonce (unique per blob write)
  ct: ByteString,             // encrypted canonical JSON of the plaintext tree
}
```

### Object store `prefs` → keyed scalars (NOT secret)
```
theme: dark | light          // dark-only v1, kept for future
autoLockMinutes: number      // e.g. 2
```

## Plaintext tree (inside the blob — never at rest unencrypted)

```
{
  formatVersion: 1,
  identities: [
    {
      id: "uuid",
      fullName: string,          // plaintext inside blob
      algorithm: 0|1|2|3,        // Spectre version
      sites: [                   // saved site metadata (passwords are NEVER stored)
        {
          id: "uuid",
          name: string,          // site domain / label
          counter: number,       // Spectre site counter (default 1)
          template: number,      // resultType id (password templates)
          purpose: 'password'|'login'|'answer',
          login?: string,        // saved login name (encrypted inside blob)
          answer?: string,       // saved security answer (encrypted inside blob)
        }
      ],
    }
  ]
}
```

**Note on "identity picker before unlock":** as designed in T4, the picker renders *after* the passkey gate (names are inside the decrypted blob) — so nothing secret needs to survive at rest in a separate plaintext store. Zero plaintext user data at rest.

## Write path (read-modify-write under navigator.locks)

```
lock('spectre-pocket:write'):
  newIv = random(); blob = AES-GCM(ctx, iv=newIv, plaintext)
  → put(blob) in vault store; commit envelope unchanged
```
Concurrent tabs: serialize writes behind `navigator.locks.request`; re-read envelope before each write.

## What this prototype needs the human to confirm

1. Whole-vault-blob (A) over per-record — acceptable for a tiny single-user vault? (Recommend: yes.)
2. Everything encrypted at rest, including identity names — relies on passkey gate coming first at every launch. OK, or do you want names readable pre-unlock (would force a plaintext-at-rest name column, weakening the threat model)?
3. Recovery code accessible from the locked screen (type it to unwrap) — separate from app UI, vs only via a "forgot passkey" flow.
4. counter/template as the "must-have" v1 site fields; login/answer optional-but-schemed.

## Files

- This document.
- `src/lib/vault/` module sketch (types + IndexedDB wrapper) — code-level view of the schema above.