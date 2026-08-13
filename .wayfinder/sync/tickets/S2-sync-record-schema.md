---
id: S2
title: Sync record schema and merge rules
type: grilling
status: closed
blocked_by: []
assigned: dev
---

## Question

What exactly lives in the iroh doc, and how do merges resolve?

- **Identity records**: each identity = one encrypted record (id, fullName, algorithm, sites[]). Are ids the v1 uuids, or new per-doc ids?
- **Envelope records**: per-device wrapped DEKs (passkey wrap + recovery wrap). One shared envelope key/record in the doc, or one envelope record per device?
- **Merge/conflict policy**: whole-identity LWW is confirmed. What does that mean when two devices edit *different sites* of the *same* identity concurrently — one edit silently dropped (accepted?), or per-site merge within a record?
- **Tombstones**: a deleted site/identity must propagate to peers — how? Deletion marker record, or is delete expressed as an overwrite?
- **Canonicalization**: after a merge, the same logical identity may exist as two records under two DEKs (A's copy under DEK-A, B's re-encryption under DEK-B). Which is canonical? Is a merge result a *new* record version, and who owns the merged copy?
- **Device list**: is there a doc-level device registry record, or is device membership implicit in the envelope records present?

## Resolution

- **Keys**: identity records are keyed by the **v1 identity uuid** (reuse, no new id scheme). Sites stay inside their identity record (per-identity records confirmed); a site is identified by its v1 site uuid within the record.
- **Canonicalization / ownership**: **one record per identity key, ciphertext under the last writer's DEK.** Any device can read any record: unwrap the writer's DEK from that writer's envelope (shared recovery code), decrypt. A device rewrites a record — re-encrypting under its own DEK — only when it *changes* that identity's content. No ping-pong: reads never re-encrypt, so exactly one copy of each identity exists in the doc at a time (the LWW winner), and "two copies under two DEKs" never arises.
- **Envelope records**: **one envelope record per device**, keyed by device id, holding that device's passkey wrap + recovery wrap. Readable by all (non-secret). Recovery code unwraps any writer's DEK. Device membership is **implicit in the envelope records present** — no doc-level device registry.
- **Merge/conflict**: whole-identity LWW, **silent** — concurrent edits to different sites of the same identity resolve by newest timestamp, the older edit dropped with no user notice. Accepted.
- **Deletes**: identity deletion = iroh-docs **key tombstone** (delete the doc key; tombstone wins by timestamp). Site deletion = **record rewrite** (new ciphertext under the writer's DEK, drops the site). No separate delete-marker record needed.
- **Device removal** = **stop syncing** (record of a departed device stays readable via its envelope + recovery code). No re-encrypt/revoke flow; write capability is the shared namespace secret and is not revocable in iroh-docs.
