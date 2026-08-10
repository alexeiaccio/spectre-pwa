# T4 research — Session and lock lifecycle for an offline-only Spectre PWA

Research subagent output for `.wayfinder/tickets/T4-session-lock-lifecycle.md`.
Date: 2026-08-10. All claims cited; sources listed at the end.

---

## Recommendation (concrete lock/session model)

Model the app as **two independent secrets, two independant gates**:

| Gate | Secret that unlocks it | Crypto material | What becomes browsable |
|---|---|---|---|
| **Vault unlock** | WebAuthn passkey (PRF-derived vault key, T1) | AES-GCM vault key as a non-extractable `CryptoKey` | Identity list + each identity's **saved site names** (encrypted *at rest*, decrypted in memory). No passwords. |
| **Identity session** | The Spectre **passphrase** (typed per launch, never persisted) | 64-byte `masterKey = SCRYPT(fullName-seed, passphrase)` held as a non-extractable HMAC `CryptoKey` | Site **passwords / logins / answers** (derived on tap, HMAC) |

### The lifecycle rules

1. **Always boot locked.** On any page load (cold start *or* bfcache-restore after `document.wasDiscarded`/freeze) the app starts at the passkey screen. The web platform gives no "cold vs warm launch" flag at boot; the policy "start locked, then evaluate on resume" covers both [P1].
2. **"Launch" = every foregrounding, not just cold start.** Detect it with `visibilitychange → hidden` (the only reliable event on mobile; see §PWA), then on return compare wall-clock elapsed time against a grace period:
   - hidden < **grace (default ~2 min)** → stay unlocked, resume exactly where you were;
   - hidden ≥ grace, or `document.wasDiscarded === true` (browser killed the page) → **lock** (drop all keys) and require passkey again.
   - This is the **timestamp-on-hide / evaluate-on-resume** pattern, *not* a hidden `setTimeout`: browsers throttle timers in hidden tabs and stop them entirely when frozen, so a timer cannot fire reliably in background [P1].
3. **Never auto-lock while visible** in v1 (optional later): inactivity lock by re-arming a visible-only timer on each user interaction, mirroring Bitwarden's "inactivity measured by interaction with the app, not system idle" [B3].
4. **Manual lock button, always available** (header). It must (a) drop the vault key, (b) drop the identity master-key `CryptoKey`, (c) zeroize surviving `Uint8Array`s, (d) clear clipboard, (e) render the lock screen. Because the app also locks on `visibilitychange→hidden`, the Android recents / task-switcher thumbnail will capture the lock screen rather than a site list. Best-effort: `pagehide`/`beforeunload` run the same wipe as a safety net; do not rely on them firing on mobile [P1].
5. **No "quick unlock" tier.** Lock = full re-auth (passkey assertion → biometric prompt, then passphrase). This is the honest PWA ceiling: a web app cannot hold a biometric *grace* the way native apps do; each passkey unlock re-invokes the OS user-verification gate. Say so in the UX copy.

### Wipe points (enumerated)

- On **manual lock** (button).
- On **`visibilitychange` → `hidden`** (start the grace clock *and* run the wipe immediately — safer and makes the recents thumbnail blank; re-entry decides whether to re-run passphrase. If you prefer bfcache fast-resume, do the wipe and accept that resume needs unlock).
- On **`pageshow`/`resume`** when grace expired → lock path.
- On **`pagehide`/`beforeunload`** (best-effort net, unreliable on mobile).
- On **`freeze`** (Chrome freezes hidden tabs; wipe here too).
- On **cold load / `wasDiscarded`** (nothing to wipe, locked by construction).
- **Clipboard:** auto-clear N seconds after a password copy (standard; KeePass & Bitwarden both clear the clipboard after a delay and only if it still holds our own data [K1][B4]).

### What is browsable before the passphrase

- **After passkey, before passphrase:** identity list + saved site *names*. These are not secrets cryptographically — Spectre site passwords are derived from `(fullName, passphrase, siteName, counter, template)`; knowing site names does not help derive anything without the passphrase [S2]. They are, however, a **privacy fingerprint** (what sites you use), so they must be encrypted at rest under the vault key (T2) and shown only after passkey unlock. KeePass precedent: entry titles/usernames are visible immediately after *database* unlock, but passwords stay behind asterisks and are only revealed on demand [K2].
- **Only after passphrase:** derived passwords/logins/answers for a site. No per-site prompts — the passphrase is entered once and the master key is held.

### Derive the master key once per session, not per site

`masterKey = SCRYPT(seed = scope·LEN(fullName)·fullName, passphrase, N=32768, r=8, p=2, dkLen=64)` is intentionally slow and memory-hard [S2]. On a small Android device this is tens of ms plus MBs of scrypt state. Compute it **once per identity session** and reuse it for every site:
```
passphrase → (JS scrypt) → 64-byte masterKey Uint8Array
           → await crypto.subtle.importKey("raw", masterKey, HMAC, {extractable:false}, ["sign"])
           → masterKey.fill(0)          // zeroize our copy immediately
per site  → crypto.subtle.sign("HMAC", masterKeyKey, seed=scope·LEN(site)·site·counter)
```
`siteKey = HMAC-SHA-256(key=masterKey, seed=scope·LEN(siteName)·siteName·counter)` is cheap, so per-site derivation is a single `subtle.sign` call on the held key [S2]. Re-deriving scrypt per site would multiply unlock cost by the number of sites browsed — pointless.

### Does the identity picker require the passkey first?

Yes. The passkey is the *only* thing that decrypts the vault (T1/T2 decision from the map: "passkey unlocks an encrypted local vault"). The pre-passkey picker therefore renders only non-secret identity **labels**; whether the full per-identity *name* is stored plaintext or derived from an encrypted blob is T2's call (map "Not yet specified" #1). Whatever T2 chooses, the picker may never show site names before the passkey.

---

## Comparison table — lock triggers across real password managers

| App | Trigger dimension | Concrete auto-lock options | Note on "lock" semantics |
|---|---|---|---|
| **1Password** (Mac/Win) | device / idle | "Lock when device locks or sleeps" (incl. switch users), "Lock after the device is idle for N (min)" | App also never stays open when Quick Access closes; presets "Convenient (lock w/ device) / Balanced (≈8 h desktop, 10 min mobile) / Strict (lock when not in use)" [1p1][1p3] |
| **1Password** (iOS/Android) | background / device | iOS: "Lock when device locks", "Auto-lock on exit (delay until lock after leaving the app)", "Unlock with device (auto-unlock for up to 10 min after device unlock)"; Android: "Lock when device locks"; both: biometric/passcode unlock with "Require account password" re-auth timer | Mobile defaults historically "lock on exit"; users relax it to a few minutes to tolerate app-switching [1p1][1p2][1p3] |
| **1Password** (browser extension) | browser lifecycle | "Automatically lock 1Password (after N)", "Lock after system idle for N", "Lock when device goes to sleep"; **always locks when the browser quits** [1p1] | — |
| **Bitwarden** (web/desktop) | time / refresh | Session (vault) timeout: "Time passed…", "On browser refresh", "Custom"; **lock vs logout**: lock keeps encrypted vault locally and unlocks offline (no 2FA re-check); logout removes all vault data and re-auths online [B3] | Inactivity = time since *interacting with Bitwarden*, not system idle [B3] |
| **Bitwarden** (mobile) | restart / device / inactivity | "Require master password on app restart"; session timeout incl. "On app restart", "On device lock", "On inactivity", "Immediately" (exact set varies by version) [B1][B2] | "On app restart" + action "Lock" is the widely used mobile posture; biometric/PIN lets you unlock offline after lock [B1][B3] |
| **KeePass 2.x** (desktop) | session / suspend / idle / minimize | Workspace-lock options: "Lock workspace when locking the computer or switching the user" (`LockOnSessionSwitch`, default on), "…when the computer is about to be suspended" (`LockOnSuspend`, default on), "…after N seconds of inactivity" (`LockAfterTime`), "…when minimizing the main window to…" [K1][K3] | Locking = **closes the database file entirely**, forgetting the key; "breaking a locked workspace is equal to breaking the database" [K2]; key is kept only in DPAPI-wrapped process memory otherwise [K2] |
| **KeePassXC** | device power/lock events | "Lock database when session is locked / screen off / lid closed" (listens to OS power & lock events) and "Lock database after inactivity" | Same close-the-database lock semantics as KeePass [K4] |

**Key takeaways for the PWA:**
- "Lock" in the desktop-native world means *drop the key entirely* (KeePass) or *drop key + quick local re-unlock* (1Password/Bitwarden biometric/PIN). We can only do the first — passkey re-assertion every time. That is the single biggest UX difference to document for the human.
- Default mobile posture from both big commercial managers is "lock on exit / on app restart / on device lock" — i.e. they tie locking to **background-return and device events**, not just process start. Our "evaluate on resume" rule matches that muscle memory.
- KeePass's `LockOnSessionSwitch`/`LockOnSuspend` have **no web analog**: there is no trustworthy "screen-off" event. `visibilitychange→hidden` is our best proxy (app switch, home, and screen lock generally all hide the page) [P1].

---

## PWA "launch" detection — what the platform actually gives you

Primary reference: the **Page Lifecycle API** (web.dev, Chrome 68+, formalized by WICG) [P1].

- States: `active → passive → hidden → frozen → terminated → destroyed`. JS *can* observe `hidden` via `visibilitychange`, and `frozen` via `freeze`/`resume`. `wasDiscarded` (property read at load) tells you the old page was discarded by the browser while hidden — Chrome discards hidden tabs on memory pressure or after minutes idle ("aggressive tab discarding"); on Android `wasDiscarded` support has been tracked and is present in modern Chrome.
- **`hidden` is the last state you can reliably react to on mobile:** "the hidden state is the last state that developers can reliably detect … treat the hidden state as the likely end of the user's session." Closing the tab/browser via the OS often fires *no* `beforeunload`/`pagehide`/`unload` on mobile [P1].
- `beforeunload`/`unload` are **deprecated as a pattern** for anything but unsaved-changes warnings; you must not rely on them for wiping (they may not run, and they can block bfcache) [P1].
- `freeze` runs the JS event *before* the tab is frozen — a legitimate wipe hook; `resume` fires on return (bfcache rises via `pageshow` with `persisted=true`).
- No "onLaunch" API. For an installed standalone PWA: tapping the home-screen icon either activates the still-alive page (→ `visibilitychange`/`resume`/`pageshow`) or, if the browser discarded or killed it, does a fresh page load. Treat both as a state to evaluate through the same rule in the Recommendation.

**Consequence:** an auto-lock *timer* cannot be the mechanism. Use wall-clock timestamps captured on each state change and evaluate on resume. Google's own guidance: don't run timers while hidden; assume the app won't run in background [P1].

---

## Honest note on JS memory wiping

**You cannot guarantee wiping key material in JavaScript. The goal is hygiene, not a guarantee.** Fact pattern:

1. **Raw strings can never be wiped.** The typed passphrase is a JS `string` (UTF-16). Strings are immutable; the engine (JIT, rodata strings, GC, `V8` internalization) copies them without your knowledge, and you have no zeroize primitive. Whatever you hold, the passphrase string will linger on the heap until GC. "Don't trust RAM" is not a thing you can enforce from a web page [W1][W4].
2. **Typed arrays are the only zeroizable thing.** For sensitive *derived* bytes (the 64-byte master key, vault key material you import) you can `Uint8Array.fill(0)` the buffer you own. This survives the GC timing problem for *that allocation* — it works even though overwriting the variable (reassigning `undefined`) does not. Recommended practice: import raw material into a non-extractable `CryptoKey` *immediately*, then zero the buffer [W2][W4].
3. **`CryptoKey` is the real primitive.** With `extractable: false`, `subtle.exportKey`/`wrapKey` throw; the key bytes live in the browser's internal (often native/TPM-backed) key store and never enter the JS heap as bytes you can read. This is the closest the web gets to KeePass's DPAPI-wrapped memory [W2][W3][W4].
4. **But releasing a `CryptoKey` is not deterministic.** The spec permits the user agent to discard key material when the `CryptoKey` is GC-collected — or to keep it until the whole browsing context is torn down. Engines with incentive to save memory free it on GC; you cannot force it [W3].
5. **GC copies.** Even typed arrays can be copied by the VM (e.g. into async buffers, crypto intermediates inside the engine). You can only zero what you hold.
6. **Therefore:** the honest postures are (a) minimize the lifetime of raw bytes (derive → import → zero, in one synchronous function), (b) hold everything long-lived as non-extractable `CryptoKey`s, (c) treat "wipe on lock" as "drop references + zeroize owned buffers," and (d) document that remnants of the *passphrase string* are OS/GC-dependent and out of the app's control. This is consistent with how the ecosystem speaks about it (V8/Node "zeroizable memory" is an open enhancement request, not a settled API) [W4].
7. **What the lock actually guarantees:** the *derived material* is gone from the surface the app controls, the vault ciphertext at rest is intact, and re-entry requires both factors again. That is the same protection model KeePass calls "equal to breaking the database" [K2].

---

## UX expectations & muscle memory (item 5)

- **The per-launch passphrase is a cost the user is choosing.** Spectre's design premise is that your *only* secret is the passphrase and everything else re-derives statelessly from `(fullName, secret, site, counter, template)` [S1][S2]. "Re-derive master key once per session in memory" is the safe norm: it keeps the slow scrypt step at unlock, and the app shows the passphrase screen exactly once per launch, with zero per-site prompts.
- **Match the "launch = one unlock screen" muscle memory** of all three majors (1Password lock screen on exit / Bitwarden "require on app restart" / KeePass workspace lock), with this difference made explicit: *there is no biometric grace in a web app* — a lock means passkey → (OS/fingerprint prompt) → passphrase. We should tune the grace period so that ordinary short app-switches (copy a password, glance at a site) do not trip it, mimicking 1Password's "auto-lock on exit, delay N" and Bitwarden's "on app restart".
- **After passphrase, no prompts while the session lives** — that's the "session's duration" the human specified. Switching identities inside a session should prompt **again only if that identity has its own different secret** (each Spectre identity has its own full-name + secret [map]); the previous identity's master key is wiped at switch.
- **Document the two-tier honest model in-app:** "Passkey opens your vault. Your passphrase is never stored — it is derived fresh each time you launch."

---

## Sources (cited)

- **S1** — Spectre.app *About* / algorithm overview, `spectre-app/api` README ("Don't store; derive"): https://github.com/spectre-app/api
- **S2** — Maarten Billemont, *Master Password — Liberating yourself* (algorithm PDF): https://spectre.app/spectre-algorithm.pdf — masterKey = SCRYPT(name, secret, N=32768, r=8, p=2, dkLen=64); siteKey = HMAC-SHA-256(masterKey, scope·site·counter); scope codes `com.lyndir.masterpassword`{,·login,·answer}.
- **P1** — Philip Walton (Google), *Page Lifecycle API* (web.dev / WICG spec): https://developers.google.com/web/updates/2018/07/page-lifecycle-api (`hidden` = last reliable mobile state; `freeze`/`resume`; `wasDiscarded`; deprecation of `unload`/`beforeunload`; don't run timers while hidden).
- **1p1** — 1Password support, *Manage your unlock and auto-lock settings*: https://support.1password.com/unlock-auto-lock/
- **1p2** — 1Password community, *Auto Locking after a few seconds* + *Why did 1Password 8 auto-lock?*: https://www.1password.community/1password-at-home-31/auto-locking-after-a-few-seconds-4861 · https://www.1password.community/1password-at-home-31/why-did-1password-8-auto-lock-14662
- **1p3** — 1Password Business *Enforce unlock and auto-lock settings* (presets Convenient/Balanced/Strict): https://support.1password.com/unlock-auto-lock-policy/
- **B1** — Bitwarden community, *"On app restart" vault timeout on mobile*: https://community.bitwarden.com/t/seeking-input-on-on-app-restart-vault-timeout-behavior-on-mobile/97074
- **B2** — Bitwarden help, *Client App Settings* (mobile session timeout, "Require master password on app restart", Clear clipboard): https://bitwarden.com/help/app-settings/
- **B3** — Bitwarden help, *Vault timeout* (timeout measured by interaction not system idle; Lock vs Logout; offline unlock after lock): https://bitwarden.com/help/vault-timeout/
- **B4** — Bitwarden *App settings* "Clear clipboard" (above).
- **K1** — KeePass help, *Enforced Configuration* (workspace-locking XML keys `LockOnSessionSwitch`, `LockOnSuspend`, `LockAfterTime`, `ClipboardClearAfterSeconds`): https://keepass.info/help/kb/config_enf.html
- **K2** — KeePass help, *Security* ("Process memory protection", DPAPI; "Locking the workspace = closing the database… equal to breaking the database"): https://keepass.info/help/base/security.html
- **K3** — KeePass help, *Technical FAQ* ("lock when Windows locks", inactivity lock, sub-dialogue exception): https://keepass.info/help/base/faq_tech.html
- **K4** — KeePassXC issue #11957 (lock on session lock / screen off / lid close listening to OS events): https://github.com/keepassxreboot/keepassxc/issues/11957
- **W1** — Rust Foundation / RustCrypto *zeroize* docs ("Securely clear secrets… volatile semantics", that even Rust can't guarantee against Spectre-class leaks): https://docs.rs/zeroize/latest/zeroize/ · https://lib.rs/crates/zeroize
- **W2** — Loke.dev, *Non-Extractable Web Crypto Keys* (import-then-zero pattern; CryptoKey = handle; XSS/GC caveats): https://loke.dev/blog/non-extractable-web-crypto-keys
- **W3** — Stack Overflow, *How do you destroy keys with SubtleCrypto?* (spec: UA *may* free key material on GC *or* keep until context teardown): https://stackoverflow.com/questions/67495801/how-do-you-destroy-keys-with-subtles-cryptography-api
- **W4** — Node.js issue #59965, *Zeroizable and pinnable memory for cryptographic hygiene* (acknowledgement that GC makes JS zeroization an open gap): https://github.com/nodejs/node/issues/59965
- **W5** — MDN, *CryptoKey` / `extractable``: https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey