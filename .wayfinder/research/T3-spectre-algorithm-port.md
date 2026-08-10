# T3 — Spectre password algorithm: authoritative reference, versions, parameters, test vectors

**Status:** research complete · decision-ready
**Date:** 2026-08-10
**Scope:** offline-only TypeScript port of the Spectre (formerly *Master Password*) password cipher, bit-identical to spectre.app
**Verification:** every claim below is cross-checked against the reference implementation *and* validated by running an independent implementation against the official test corpus — **60/60 official test vectors pass**.

---

## Recommendation

1. **Source of truth: the Spectre web implementation** `js/spectre/spectre-algorithm.js` in the **`spectre.app/web`** GitLab repo (raw: `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/spectre-algorithm.js`). It is the current, maintained, browser-shipped implementation of the algorithm, with constants in `spectre-types.js` and its own scrypt in `scrypt.js`/`pbkdf2.js`. It embeds a self-test whose expected value (`Jejr5[RepuSosp`) is *itself* an official Master Password test vector — proof that Spectre ⇔ Master Password are bit-identical.
2. **Authoritative specification/cross-check: the C core in Lyndir's Master Password repo** (`platform-independent/c/core/src/mpw-algorithm_v{0,1,2,3}.c`, `mpw-util.c`, `mpw-types.c`). This is the *actual* C algorithm core. ⚠️ **Correction to the task brief:** the `spectre.app/android` repo is **not** the C core — it is only the old Master Password Android *UI* (`src/main/java/com/lyndir/masterpassword/` plus `CMakeLists.txt` glue). Do not port from it.
3. **Test corpus: the official vector set** `platform-independent/c/cli/mpw_tests.xml` (61 cases, 60 concrete) from `Lyndir/MasterPassword`. I re-implemented the algorithm from scratch in Node (`node:crypto` scrypt + HMAC-SHA-256) and **all 60 concrete cases reproduce exactly**, including the V0 16-bit-endian quirk and the multibyte (snowman 🛷 `⛄`) cases that segment V0/V1/V2/V3.
4. **Where the TS port should live:** in the spectre-pwa repo as `src/lib/spectre/` with three files mirroring the reference layout:
   - `spectre-types.ts` — enums, scopes, resultType ids, templates, character classes (constants copied from `spectre-types.js`).
   - `spectre-algorithm.ts` — `newUserKey` / `newSiteKey` / `newSiteResult` (byte-level port of `spectre-algorithm.js`, incl. the per-version length bugs).
   - `scrypt.ts` — RFC-7914 scrypt (see §6 for library choice).
   - `spectre-algorithm.test.ts` — the vector table from §5 verbatim.
   Default algorithm version **3**; implement 0–3 for legacy-identity compatibility.
5. **No HKDF.** The Spectre/Master Password algorithm uses **no HKDF in any released version** (V0–V3). Master key = scrypt; site key = plain HMAC-SHA-256. Do not add HKDF stages to the port. (WebCrypto *does* expose HKDF, but it is not needed here — see §6.)

---

## 1. Algorithm versions

All four versions exist in Spectre and Master Password and are byte-for-byte identical between the two products.

| Version | Date       | Defect recorded in code                             |
|---------|------------|-----------------------------------------------------|
| V0      | 2012-03-05 | "Host-endian math" — site-key bytes translated into 16-bit big-endian numbers before template/character indexing. Also user- and site-name lengths counted as characters, not bytes. |
| V1      | 2012-07-17 | Site-name field sized by *character* count instead of *byte* count. |
| V2      | 2014-09-24 | User-name field sized by *character* count instead of *byte* count. |
| V3      | 2015-01-15 | Current version (fixes V2's user-name length). |

The comments above are quoted verbatim from `spectre-types.js` (algorithm enum) and `mpw-algorithm.h` (MPAlgorithmVersion enum). All four versions share the *same* scrypt parameters and HMAC construction — the versions differ **only** in (a) which length (char vs byte) is written into the salts and (b) V0's extra 16-bit translation.

## 2. Parameters per version

scrypt parameters are **identical for all versions** (V0=V1=V2=V3):

| Parameter          | Value  | Notes                                            |
|--------------------|--------|--------------------------------------------------|
| scrypt N           | 32768  | (= 2¹⁵)                                          |
| scrypt r           | 8      |                                                  |
| scrypt p           | 2      |                                                  |
| scrypt dkLen       | 64     | master key is 64 bytes                           |
| memory            | 128 · N · r = 33 554 432 bytes | ~33.5 MiB working set — plan for this in the PWA |
| site key algorithm | HMAC **SHA-256** | 32-byte output (SHA-256 size)                    |
| counter encoding   | uint32,b big-endian | identical bytes whether signed (JS `setInt32`) or unsigned (C `push_int`) |
| user-key salt scope | `com.lyndir.masterpassword` | same for all versions |

### Per-version salt-length rules (the *only* version-dependent bytes)

| Field                 | V0      | V1      | V2      | V3      |
|------------------------|---------|---------|---------|---------|
| user salt: `LEN(fullName)` | chars | chars | chars | **bytes** |
| site salt: `LEN(siteName)` | chars | chars | **bytes** | **bytes** |
| site salt: `LEN(keyContext)` | JS impl: always bytes (see note) | bytes | bytes | bytes |
| result bytes → template | 16-bit BE transform | raw | raw | raw |

> **C-vs-JS divergence alert (low risk, decide explicitly):** the *C* core (`mpw-algorithm_v0.c`) sizes `keyContext` by *character* count in V0/V1, while the Spectre *JS* implementation always uses byte count in every version. Both match the official corpus because all official context vectors are ASCII (chars == bytes). For the TS port, **mirror the JS implementation (always byte count)** since it is the Spectre reference; document this one-byte corner case for non-ASCII contexts.

## 3. KDF parameters in exact form

Both references coincide (`spectre-algorithm.js` newUserKey/newSiteKey; `mpw-algorithm_v3.c`; `mpw-util.c`); the technical paper (`spectre-algorithm.pdf`) states the two formulas verbatim.

**Phase 1 — master key (per user):**
```
scope    = "com.lyndir.masterpassword"                       # UTF-8
nFull    = len_lookup( fullName )                              # chars or bytes, see table
salt     = scope ‖ uint32BE(nFull) ‖ utf8(fullName)
masterKey(64) = scrypt( key=utf8(masterPassword), salt, N=32768, r=8, p=2, dkLen=64 )
```
(Paper notation: `masterKey = SCRYPT(key, seed, N, r, p, dkLen)`, `N=32768, r=8, p=2, dkLen=64`, `seed = scope . LEN(<name>) . <name>`.)

**Phase 2 — site key (per site/counter/purpose):**
```
scope    = lookup( purpose )                                  # see §4
nSite    = len_lookup( siteName )
counter  = uint32BE( keyCounter )                             # 1..2³²−1 (or 0 ⇒ TOTP, unused in port)
salt     = scope ‖ uint32BE(nSite) ‖ utf8(siteName) ‖ uint32BE(counter)
             [ ‖ uint32BE(len(keyContext)) ‖ utf8(keyContext) ]   # optional context
siteKey(32) = HMAC-SHA-256( key=masterKey(64), msg=salt )
```
(Paper: `siteKey = HMAC-SHA-256(key=masterKey, seed=scope . LEN(<site name>) . <site name> . <counter>)`.)

**Phase 3 — template rendering:**
```
templates = templates[resultType]
tpl       = templates[ siteKey[0]  % len(templates) ]
for i in 0..len(tpl):
    out += chars[tpl[i]][ siteKey[i+1] % len(chars[tpl[i]]) ]
```
(Paper: `template = templates[<site key>[0] % LEN(templates)]`; `passWord[i] = passChars[<site key>[i+1] % LEN(passChars)]`.)

**V0 exception (Phase 3):** for `algorithmVersion == 0`, each site-key byte `b` is first translated to a 16-bit big-endian value:
`b16 = (b > 127 ? 0x00FF : 0x0000) | (b << 8)` (JS) — the C core does the same via `mpw_uint16`, which is why the comment says V0 "performed host-endian math with bytes translated into 16-bit network-endian." The `b16` array then feeds the template/character indexing.

**HKDF status:** none. A grep of the C core (only `mpw_kdf_scrypt`, `mpw_kdf_blake2b` for the optional `deriveKey` result type, and `mpw_hash_hmac_sha256`) and of the full commit history (`Lyndir/MasterPassword` + `hkdf` → 0 commits) confirms no HKDF in any released version. The optional `deriveKey` output template (`resultType` 4160) uses BLAKE2b, not HKDF, and is **out of scope** for a password-port.

## 4. Namespacing / vault compatibility (the KEY question)

**Spectre is Master Password — same namespaces, same everything.**
- The KDF scope strings are **unchanged** from Master Password. Spectre's `spectre-types.js`: `purpose.authentication = "com.lyndir.masterpassword"`, `identification = "com.lyndir.masterpassword.login"`, `recovery = "com.lyndir.masterpassword.answer"`. The C core's `mpw-types.c` returns exactly these three strings; the paper's "Table 1 — Key Scopes" lists the same.
- `spectre-algorithm.js` hard-codes a self-test: `user("Robert Lee Mitchell","banana colored duckling").password("masterpasswordapp.com") === "Jejr5[RepuSosp"` — which is precisely the official Master Password V1/V2/V3 vector.
- **Empirical proof:** my independent Node implementation (Node's native `scrypt` + `createHmac('sha256')`, zero shared code with the app) reproduced **all 60 concrete** official vectors from `mpw_tests.xml`.
- **Conclusion:** a Spectre V3 password is *byte-identical* to a Master Password V3 password for the same inputs; existing Master Password identities, and any Master Password–derived site keys/passwords, are fully portable into the Spectre port with**out** re-keying. The only divergence risk is if you change the scope strings — do not.

## 5. Test vector corpus (verified, ready to paste)

All values below come from the **official** corpus `Lyndir/MasterPassword/platform-independent/c/cli/mpw_tests.xml` (xml-encoded `&amp;` unescaped to `&`), and were **re-derived and verified** by my independent implementation. Default identity unless overridden:

- `fullName = "Robert Lee Mitchell"`, `masterPassword = "banana colored duckling"`, `siteName = "masterpasswordapp.com"`, `keyCounter = 1`, `keyPurpose = Authentication`.

### 5.1 Version/prod default matrix (site `masterpasswordapp.com`, counter 1, Long)

| Version | Password          | Master-key ID (SHA-256 hex of 64-byte key)                     |
|---------|-------------------|----------------------------------------------------------------|
| V0      | `Feji5@ReduWosh`  | 98EEF4D1DF46D849574A82A03C3177056B15DFFCA29BB3899DE4628453675302 |
| V1      | `Jejr5[RepuSosp`  | 98EEF4D1...5302 (same — V1 user-name fix only affects non-ASCII) |
| V2      | `Jejr5[RepuSosp`  | 98EEF4D1...5302                                                |
| V3      | `Jejr5[RepuSosp`  | 98EEF4D1...5302                                                |

### 5.2 V3 result-type matrix (identity above, counter 1)

| resultType             | purpose        | result                  |
|------------------------|----------------|-------------------------|
| Long (17), also defaultPassword | Authentication | `Jejr5[RepuSosp` |
| Maximum (16)           | Authentication | `W6@692^B1#&@gVdSdLZ@`  |
| Medium (18)            | Authentication | `Jej2$Quv`              |
| Basic (20)             | Authentication | `WAo2xIg6`              |
| Short (19)             | Authentication | `Jej2`                  |
| PIN (21)               | Authentication | `7662`                  |
| Name (30), defaultLogin | Identification | `jejraquvo`            |
| Phrase (31), defaultAnswer | Recovery    | `jejr quv cabsibu tam` |
| login name (Name / Identification) | Identification | `wohzaqage` |
| answer (Phrase / Recovery) | Recovery     | `xin diyjiqoja hubu`    |
| answer w/ context `"question"` | Recovery | `xogx tem cegyiva jab` |

### 5.3 Counter ceiling (all versions, Long)

| Version | counter 4294967295 → |
|---------|------------------------|
| V0      | `QateDojh1@Hecn`       |
| V1      | `XambHoqo6[Peni`       |
| V2      | `XambHoqo6[Peni`       |
| V3      | `XambHoqo6[Peni`       |

### 5.4 Multibyte (U+26C4 `⛄`) cases — exercise the version-defining length logic

| case                       | V0             | V1             | V2             | V3             |
|----------------------------|----------------|----------------|----------------|----------------|
| `fullName = "⛄"`            | `HajrYudo7@Mamh` | `WaqoGuho2[Xaxw` | `WaqoGuho2[Xaxw` | `NopaDajh8=Fene` |
| `masterPassword = "⛄"`      | `MewmDini0]Meho` | `QesuHirv5-Xepl` | `QesuHirv5-Xepl` | `QesuHirv5-Xepl` |
| `siteName = "⛄"`            | `HahiVana2@Nole` | `WawiYarp2@Kodh` | `LiheCuwhSerz6)` | `LiheCuwhSerz6)` |

Observations (consistent with §2): V1==V2 for multibyte *fullName* (site-name length is byte-based in both); V2==V3 for multibyte *siteName* (site-name length byte-based in both); V0 differs everywhere (16-bit transform + char counts).

### 5.5 Independent third vector (mpw-js self-test, counter 0 — attribute carefully)

Official JS library `Lyndir/mpw-js` self-test: `name="user"`, `password="password"`, `site="example.com"`, **counter = 0**, Long → **`KezpWado2+Fazo`**. Note the nonstandard counter 0 (the configured default is 1); include it only if you mirror the mpw-js test suite.

### 5.6 Ready-to-paste TypeScript test (subset that covers all version logic)

```ts
// spectre-algorithm.test.ts — paste into the port
import { describe, it, expect } from 'vitest';
import { newUserKey, newSiteResult } from './spectre-algorithm';

const NAME = 'Robert Lee Mitchell';
const SECRET = 'banana colored duckling';
const SITE = 'masterpasswordapp.com';

describe('spectre algorithm', () => {
  async function pw(version, site = SITE, counter = 1, purpose = 'authentication', context = null, type = 'long') {
    const userKey = await newUserKey(NAME, SECRET, version);
    return newSiteResult(userKey, site, type, counter, purpose, context);
  }

  it('is bit-identical to Master Password V3 (official vector)', async () => {
    expect(await pw(3)).toBe('Jejr5[RepuSosp');
  });
  it('V0 host-endian quirk', async () => {
    expect(await pw(0)).toBe('Feji5@ReduWosh');
  });
  it('result types (V3)', async () => {
    expect(await pw(3, SITE, 1, 'authentication', null, 'maximum')).toBe('W6@692^B1#&@gVdSdLZ@');
    expect(await pw(3, SITE, 1, 'authentication', null, 'medium')).toBe('Jej2$Quv');
    expect(await pw(3, SITE, 1, 'authentication', null, 'basic')).toBe('WAo2xIg6');
    expect(await pw(3, SITE, 1, 'authentication', null, 'short')).toBe('Jej2');
    expect(await pw(3, SITE, 1, 'authentication', null, 'pin')).toBe('7662');
  });
  it('purpose scoping', async () => {
    expect(await pw(3, SITE, 1, 'identification', null, 'name')).toBe('wohzaqage');
    expect(await pw(3, SITE, 1, 'recovery', null, 'phrase')).toBe('xin diyjiqoja hubu');
    expect(await pw(3, SITE, 1, 'recovery', 'question', 'phrase')).toBe('xogx tem cegyiva jab');
  });
  it('counter ceiling', async () => {
    expect(await pw(3, SITE, 4294967295)).toBe('XambHoqo6[Peni');
    expect(await pw(0, SITE, 4294967295)).toBe('QateDojh1@Hecn');
  });
  it('multibyte length rules pin the encoding logic', async () => {
    expect(await pw(0, '⛄')).toBe('HahiVana2@Nole');
    expect(await pw(1, '⛄')).toBe('WawiYarp2@Kodh');
    expect(await pw(2, '⛄')).toBe('LiheCuwhSerz6)');
    expect(await pw(3, '⛄')).toBe('LiheCuwhSerz6)');
  });
});
```

## 6. SCRYPT & HKDF library availability for the TS PWA

**SCRYPT — there is no `WebCrypto.subtle` scrypt.** The web platform exposes scrypt *neither* under `subtle` nor otherwise. The port must ship its own RFC-7914 scrypt. Verified options, in order of recommendation:

| Option | Type | Why | Notes |
|--------|------|-----|-------|
| `@stablelib/scrypt` | pure TypeScript, zero deps | RFC 7914, authored by Dmitry Chestnykh (TweetNaCl/NaCl ecosystem, audited), runs in worker, easy tree-shaking for offline PWA | Slow-ish in pure JS: expect ~1–2 s per master key for N=32768/r=8/p=2; run in a worker to avoid blocking UI. |
| vendor the app's own `scrypt.js` (Tom Thorogood, CC-BY-4.0, port of golang.org/x/crypto/scrypt) | JS | Used by **spectre.app/web itself** (raw: `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/scrypt.js`) — guaranteed bit-identical with the source of truth; pairs with its `pbkdf2.js` (native WebCrypto PBKDF2 with a JS fallback) | License compatible (CC-BY-4.0 / GPLv3 app headers — verify in the port's LICENSE notices). |
| `libsodium.js` | WASM | `crypto_pwhash_scryptsalsa208sha256_ll` — audited, fastest (~100–200 ms), proven against reference vectors | Heavier dependency (wasm bundle) — justify only if master-key derivation UX needs it. |

> All RFC-7914 scrypt implementations are output-identical; the master key is a pure function of (password, salt, N, r, p, dkLen). Any of the three is safe for bit-compat; the tests in §5.6 are the arbiter.

**HKDF — available, but not needed.** WebCrypto ships HKDF in every evergreen browser *and worker*:
```ts
const ikm = await crypto.subtle.importKey('raw', keyMaterial, 'HKDF', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, ikm, 256);
```
Supported since Chrome 42 / Firefox 43 / Safari 11 (broad baseline in 2026). The Spectre algorithm does **not** use HKDF, so the password port has zero HKDF surface. Reserve it only for ancillary use cases the PWA adds on top (e.g., wrapping a local vault key).

**Node/harness note:** in Node ≥ 15.13 `node:crypto` exposes `scryptSync`/`scrypt` and `createHmac('sha256')`; this is what the verification harness in this research used. `crypto.subtle` exists in Node ≥ 15 but is not needed since Node's native scrypt suffices.

---

## Appendix A — constants to copy (from `spectre-types.js` / `mpw-types.c`)

**Purpose scopes (byte-for-byte):** `authentication = "com.lyndir.masterpassword"`, `identification = "com.lyndir.masterpassword.login"`, `recovery = "com.lyndir.masterpassword.answer"`.

**resultType ids:** Maximum `16` (`0x10`), Long `17`, Medium `18`, Short `19`, Basic `20`, PIN `21`, Name `30` (`0x1E`), Phrase `31` (`0x1F`), (stateful/derive classes out of scope). Defaults: password→17, login→30, answer→31.

**counter range:** default `1`, min(totp) `0`, max `4294967295`.

**Templates (identical in both references; `spectre-types.js` vs `mpw-types.c`):**
- Maximum: `["anoxxxxxxxxxxxxxxxxx","axxxxxxxxxxxxxxxxxno"]`
- Long (21 templates): `["CvcvnoCvcvCvcv","CvcvCvcvnoCvcv","CvcvCvcvCvcvno","CvccnoCvcvCvcv","CvccCvcvnoCvcv","CvccCvcvCvcvno","CvcvnoCvccCvcv","CvcvCvccnoCvcv","CvcvCvccCvcvno","CvcvnoCvcvCvcc","CvcvCvcvnoCvcc","CvcvCvcvCvccno","CvccnoCvccCvcv","CvccCvccnoCvcv","CvccCvccCvcvno","CvcvnoCvccCvcc","CvcvCvccnoCvcc","CvcvCvccCvccno","CvccnoCvcvCvcc","CvccCvcvnoCvcc","CvccCvcvCvccno"]`
- Medium: `["CvcnoCvc","CvcCvcno"]` · Short: `["Cvcn"]` · Basic: `["aaanaaan","aannaaan","aaannaaa"]` · PIN: `["nnnn"]` · Name: `["cvccvcvcv"]` · Phrase: `["cvcc cvc cvccvcv cvc","cvc cvccvcvcv cvcv","cv cvccv cvc cvcvccv"]`

**Character classes:**
```
V="AEIOU"  C="BCDFGHJKLMNPQRSTVWXYZ"  v="aeiou"  c="bcdfghjklmnpqrstvwxyz"
A="AEIOUBCDFGHJKLMNPQRSTVWXYZ"
a="AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz"
n="0123456789"  o="@&%?,=[]_:-+*$#!'^~;()/."  x="AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789!@#$%^&*()"  ' '=" "
```
> The *paper's* `X` and the *spec's* `x` are the same set; the C/JS `x` set (used by Maximum) uses `!@#$%^&*()` for its non-alnum tail, exactly as above. Copy the code's string, not the paper's typography.

## Appendix B — cited sources

1. Spectre web implementation (source of truth): `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/spectre-algorithm.js` — branch `main`, HEAD commit `8588ba2ac20eafb05c322c2ab4d40302b66ac9d0` (2026-01-07) at time of writing.
2. Spectre web constants/templates/scopes: `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/spectre-types.js`
3. Spectre web worker: `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/spectre-worker.js`
4. Spectre web scrypt (Tom Thorogood, CC-BY-4.0): `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/scrypt.js`
5. Spectre web pbkdf2: `https://gitlab.com/spectre.app/web/-/raw/main/js/spectre/pbkdf2.js` (native WebCrypto PBKDF2 + JS fallback)
6. Technical paper: `https://spectre.app/spectre-algorithm.pdf` — extracted text = *"Master Password — Liberating yourself: An algorithm for freedom"* (© 2010–2018 Maarten Billemont, 8 pp.); states scrypt(N,r,p,dkLen)=(32768,8,2,64), `siteKey = HMAC-SHA-256`, and the three Key Scopes.
7. Android repo (found **not** to contain the C core): `https://gitlab.com/spectre.app/android` (tree via `https://gitlab.com/api/v4/projects/spectre.app%2Fandroid/repository/tree?recursive=true&path=src`), HEAD `ca3eaebb…` (2019-10-23) — old MP UI only.
8. C algorithm core (authoritative spec): `https://github.com/Lyndir/MasterPassword/tree/master/platform-independent/c/core/src` → `mpw-algorithm.c/.h`, `mpw-algorithm_v0.c`, `mpw-algorithm_v1.c`, `mpw-algorithm_v2.c`, `mpw-algorithm_v3.c`, `mpw-util.c`, `mpw-types.c/.h`.
9. Official test corpus (61 cases / 60 concrete): `https://github.com/Lyndir/MasterPassword/blob/master/platform-independent/c/cli/mpw_tests.xml` (last touched by commit `c2aafd86…`, 2018-06-06).
10. Official JS MP port (self-test vector `KezpWado2+Fazo`, counter 0): `https://github.com/Lyndir/mpw-js` (`mpw.js`, README).
11. Historical algorithm page (templates/classes, open algorithm spirit; 2012 snapshot shows counter default `0`): `https://web.archive.org/web/2012/http://masterpasswordapp.com/algorithm.html`
12. Library facts: WebCrypto lacks scrypt (needs a JS/WASM RFC-7914 implementation); HKDF available in WebCrypto since Chrome 42/Firefox 43/Safari 11.

*Verification harness used during research (not part of the deliverable): fresh Node implementation (`node:crypto` `scryptSync` + `createHmac('sha256')`, own salt assembly, V0 16-bit transform) — `PASS 60/60` against `mpw_tests.xml`.*