---
id: S2
title: Sync record schema and merge rules
type: grilling
status: open
blocked_by: [S1]
assigned:
---

## Question

What exactly lives in the iroh doc, and how do merges resolve?

- **Identity records**: each identity = one encrypted record (id, fullName, algorithm, sites[]). Are ids the v1 uuids, or new per-doc ids?
- **Envelope records**: per-device wrapped DEKs (passkey wrap + recovery wrap). One shared envelope key/record in the doc, or one envelope record per device?
- **Merge/conflict policy**: whole-identity LWW is confirmed. What does that mean when two devices edit *different sites* of the *same* identity concurrently — one edit silently dropped (accepted?), or per-site merge within a record?
- **Tombstones**: a deleted site/identity must propagate to peers — how? Deletion marker record, or is delete expressed as an overwrite?
- **Canonicalization**: after a merge, the same logical identity may exist as two records under two DEKs (A's copy under DEK-A, B's re-encryption under DEK-B). Which is canonical? Is a merge result a *new* record version, and who owns the merged copy?
- **Device list**: is there a doc-level device registry record, or is device membership implicit in the envelope records present?
