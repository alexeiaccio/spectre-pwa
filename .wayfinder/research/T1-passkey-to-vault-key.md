# T1 — Can a passkey (WebAuthn) unlock a fully-local encrypted vault? Yes, via the `prf` extension. Chrome-on-Android 2026, serverless & offline.

STATUS: researched 2026-08 (Corbado matrix updated 2026-08-03; WebAuthn L3 CR snapshot 2026-05-26; passkeys.dev 2026-05-20).
TARGET: installed offline-only PWA on modern Chrome for Android, served once from https, then used offline forever. No server at unlock time.

## TL;DR (decision summary)

- The supported, standard mechanism is the **WebAuthn `prf` extension** (Pseudo-Random Function, backed by CTAP2 `hmac-secret`). During a `navigator.credentials.get()` ceremony the (platform) authenticator returns a deterministic **32-byte, per-credential PRF output** for a salt you supply. Feed it through **HKDF → AES-GCM key** and you have a symmetric vault key that never needs to be stored or transmitted. ([W3C PRF explainer](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md); [MDN extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)).
- **Chrome for Android: PRF is stable and on by default.** Google Password Manager passkeys include PRF for free because Blink's Intent-to-Ship covered all six Chromium platforms (Chrome/Edge ≥128 desktop, **Chrome Android ≥130**), with the FRP riding on Google Play Services' WebAuthn stack. No flags needed. ([Chrome Platform Status](https://chromestatus.com/feature/5138422207348736); [Blink Intent to Ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI); [passkeyprf.com matrix](https://www.passkeyprf.com/)).
- Real products already do exactly this: **Bitwarden** unlocks the vault without a master password, **1Password** PRF-encrypts data with stored passkeys, **Dashlane+Yubico**, **WhatsApp** (chat backups), **Confer** (root key material). ([Bitwarden](https://bitwarden.com/help/login-with-passkeys); [1Password](https://1password.com/blog/encrypt-data-saved-passkeys); [lilting roundup](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)).
- **Neither the auth signature nor anything else you get from a passkey is usable as a key — only PRF is.** The assertion signature is challenge-dependent and unpredictable; the public key is public; authenticatorData is not secret. PRF is the one designed channel. See §6 for fallbacks.
- **Design warning (take seriously):** PRF output is bound to *that one credential*. Delete/lose the passkey → the key is irreproducible → vault is gone. Spec co-editor Tim Cappalli explicitly warns against using PRF as the only path to encryption keys and recommends **envelope encryption** (wrap a random DEK per-passkey, plus a typed recovery code) — exactly what Bitwarden/1Password do. ([lilting/Cappalli](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)).
- Bottom line for Spectre: `create()` (setup, first run) and `get()` (unlock) both work fully **offline** on Chrome Android once the passkey exists on that device; the PWA must be served from https to be a secure context, but after install the authenticator is local. Store the salt and wrapped keys in IndexedDB; generate the challenge locally with `crypto.getRandomValues`.

---

## 1. The mechanism — exactly what PRF returns

A PRF (`hmac` under a hardware/authenticator-held key) is a deterministic random oracle: same credential + same salt → same output, forever; different salt/credential → unrelated output. WebAuthn's `prf` extension lets the page ask for **one or two** evaluations per ceremony.

- Input: up to two salts the page supplies — `first` (current) and optional `second` (next, for key rotation).
- Output: per selected credential, a **32-byte `ArrayBuffer`** (`prf.results.first` / `.second`).
- **Domain separation:** before the salt reaches CTAP2 `hmac-secret`, the browser hashes it with the fixed prefix `"WebAuthn PRF" + NULL`, so web-derived outputs can never collide with non-web uses of the underlying hmac-secret (e.g. disk decryption). The app never sees or manages the hmac-secret itself. ([Corbado §2](https://www.corbado.com/blog/passkeys-prf-webauthn); [lilting](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)).
- The W3C L3 spec notes you can "query the PRF during assertions" and that it's built on CTAP2 `hmac-secret`, so hardware keys (YubiKey 5 ≥ firmware 5.2, Titan, Feitian) and platform/synced passkeys that expose hmac-secret all work. ([issue #1830 — emlun's answers](https://github.com/w3c/webauthn/issues/1830); [W3C explainer](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md)).
- PRF never runs silently: it is part of a full WebAuthn ceremony, so the user sees the usual confirmation/biometric prompt. ([W3C explainer, Privacy](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md)).

### PRF vs alternatives
- **largeBlob / credBlob / blob-at-creation:** storage-only, ~1KB, not key derivation; Chrome devs explicitly preferred PRF over largeBlob for encryption. ([Corbado FAQ](https://www.corbado.com/blog/passkeys-prf-webauthn)).
- **Signatures / authenticatorData / public key as key material:** explicitly rejected — "none of these are valid secret material for deriving encryption keys." ([hakhub §2026](https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/)).
- **Password-derived keys (PBKDF2, stretched master key):** what PRF replaces — authenticator-bound entropy instead of a memorized secret. ([Corbado §10](https://www.corbado.com/blog/passkeys-prf-webauthn)).

---

## 2. Chrome on Android: support status in 2026

### Browser stack
- Chrome/Edge: PRF shipped default-on in Chromium **≥128** (desktop) and **Chrome Android ≥130**; same Blink code path on Android. ([passkeyprf.com](https://www.passkeyprf.com); [Chrome Platform Status](https://chromestatus.com/feature/5138422207348736); [Blink intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI)).
- Windows Hello gained `hmac-secret` only via the **Feb 2026** cumulative update KB5077181 (build 26200.7840+, 25H2); needed for Windows desktop but irrelevant to Android. ([Corbado §5.1.1](https://www.corbado.com/blog/passkeys-prf-webauthn)).
- Android Firefox: **no PRF support** (this is why GPM-PRF is advertised "except Firefox"). ([Corbado §5.1.4](https://www.corbado.com/blog/passkeys-prf-webauthn)).
- Not on the Android path but for completeness: macOS 15+ works in Safari 18+, Chrome 132+, Firefox 139; iOS/iPadOS work via iCloud Keychain (data-loss bug in iOS 18.0–18.3, fixed in 18.4+). ([Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn); [hakhub](https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/)).

### Authenticator / provider stack (what actually matters on Android)
- **Google Password Manager (GPM) is the default passkey provider on Android.** All GPM passkeys include PRF support; it works across Chrome, Edge, Samsung Internet. ([Corbado §5.1.4](https://www.corbado.com/blog/passkeys-prf-webauthn); [issue #1830 comment 1774092530](https://github.com/w3c/webauthn/issues/1830#issuecomment-1774092530)).
- GPM is a **CTAP2.2-class synced provider**: it returns the **first PRF output already during `create()`** (Corbado's Q1-2026 instrumented testing measured ~100% PRF-on-create success for Google Password Manager and Apple Passwords). ([Corbado Key Facts + §5.2](https://www.corbado.com/blog/passkeys-prf-webauthn)).
- The desktop **"Chrome profile" authenticator does not support PRF** — doesn't apply to Chrome-on-Android (GPM is the provider there), but it's the classic live trap for developers testing on desktop Chrome. ([Blink intent](https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI); [Bitwarden "Passkey restrictions"](https://bitwarden.com/help/login-with-passkeys)).
- Third-party managers (1Password, Bitwarden) on Android also expose PRF when acting as the provider under Credential Manager. ([1Password](https://1password.com/blog/encrypt-data-saved-passkeys); [Corbado §5.1.4](https://www.corbado.com/blog/passkeys-prf-webauthn)).
- **Flags:** none. The old feature-flag era (Canary `chrome://flags`, agl's 2023 reply) is long gone; PRF is default-on stable. ([issue #1830 — agl](https://github.com/w3c/webauthn/issues/1830); [Chrome Platform Status](https://chromestatus.com/feature/5138422207348736)).

### The 4 affordability buckets (design your fallback around these)
1. No PRF at all (legacy platform authenticators, pre-25H2 Windows Hello).
2. PRF works only if it was requested **at `create()`** (some CTAP 2.0/2.1 keys with per-credential hmac-secret).
3. PRF works at `get()` even for credentials created without the flag (iCloud Keychain, **GPM**, newer tokens).
4. PRF output available **at `create()` too** (synced providers incl. GPM, iCloud).

Google Password Manager on Chrome Android is a **bucket-4 provider**: you can obtain the key at registration and at every subsequent unlock. ([Corbado §5.2](https://www.corbado.com/blog/passkeys-prf-webauthn)).

---

## 3. How the real products do it

- **Bitwarden** — unlock without master password. Flow (from their public deep-dive):
  1. `get()` authenticates AND returns the PRF key for the configured salt.
  2. Stretch the 32-byte PRF output with **HKDF** to an AES key.
  3. Use it to decrypt a stored **PRF-encrypted RSA private key** (with MAC check), then that RSA key decrypts the **user symmetric key**, which decrypts the vault → three-layer wrap. When PRF isn't available (browser or authenticator lacks it), **falls back to the master password**. ([Bitwarden contributing docs — Passkeys for decryption](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/); [Bitwarden Help](https://bitwarden.com/help/login-with-passkeys); [PRF blog](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/)).
  - Practical notes they publish: browser extension is Chromium-only for this; macOS needs a Chromium browser; "if you registered with PRF but get a master-password prompt, use the same OS/browser you registered with." ([Bitwarden Help](https://bitwarden.com/help/login-with-passkeys)).
- **1Password** — PRF in its own passkey provider (browser extension 2.26.1 beta / Android 8.10.38 beta, iOS later): any passkey stored in 1Password can be used for E2EE by third party sites. For unlocking 1Password itself they use a separate stored **device key** (wrapped), with Account Password + Secret Key as fallback. The passkey→PRF machinery ships in their open-source Rust library **`passkey-rs`** (WebAuthn L3 + CTAP2). ([1Password blog](https://1password.com/blog/encrypt-data-saved-passkeys); [passkey-rs](https://github.com/1Password/passkey-rs); [blog on open-sourcing](https://1password.com/blog/passkey-crates)).
- **Dashlane + Yubico** — first major credential manager to drive vault unlock directly from a FIDO2 key via PRF. ([lilting](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk); [w3c #1830 — Dashlane interest](https://github.com/w3c/webauthn/issues/1830)).
- **WhatsApp** — end-to-end-encrypted chat backups protected by a **passkey** (alternative to password/64-digit key); symmetric key is derived from the passkey (PRF) on-device for AES-256. ([WhatsApp blog](https://blog.whatsapp.com/encrypting-your-whatsapp-chat-backup-just-got-easier); [ghacks](https://www.ghacks.net/2025/11/03/whatsapp-chat-backup-now-supports-passkeys-to-encrypt-data); [oblique](https://oblique.security/blog/passkey-prf)).
- **Confer** (Moxie Marlinspike) — derives a **32-byte secret from the PRF extension as root key material**, then subkeys for client-side E2EE; ciphertext to a TEE for inference. ([confer.to](https://confer.to/blog/2025/12/passkey-encryption/); [oblique §Passkey PRFs](https://oblique.security/blog/passkey-prf); [lilting](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)).
- **Google "root credentials"** — is not a public name Google uses for this; the relevant fact is that GPM passkeys natively carry PRF and are themselves encrypted (an "SDS outline": local/remote envelope) with a hardware-protected Google account master key, synced & end-to-end encrypted — which is why RP-visible PRF works identically across a user's Android devices/Chrome without a server. ([Google security blog](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html); [Google passkey docs](https://developers.google.com/identity/passkeys/supported-environments)).

---

## 4. Concrete code sketches (Chrome Android, serverless & offline)

Everything below uses **locally generated challenges** — there is no server to sign against, so the signature is irrelevant to a local vault; only `prf.results` matters.

### 4.1 Registration / first-run (obtain the passkey + first PRF output)

```js
// ---- must be https origin, called from a user tap (Chrome requires user activation for create) ----
const salt = crypto.getRandomValues(new Uint8Array(32)); // store in IndexedDB; NOT secret, deterministic per install
const challenge = crypto.getRandomValues(new Uint8Array(32)); // local challenge; no server

async function createPasskeyWithPrf() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { id: "spectre.example.com", name: "Spectre" },   // rpId must be registrable-domain suffix of origin
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "local-vault", displayName: "Local vault" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: "platform", // device-bound
        residentKey: "required",             // discoverable -> usernameless get()
        userVerification: "required",
      },
      extensions: { prf: { eval: { first: salt } } }, // ask for the first PRF output AT creation
    },
  });
  const out = cred.getClientExtensionResults();
  if (!out.prf || !out.prf.results || !out.prf.results.first)
    throw new Error("PRF unsupported by this browser/authenticator");
  const prfOut = new Uint8Array(out.prf.results.first); // 32 bytes
  return { cred, prfOut };
}
```
Reference shapes from the W3C explainer and MDN: `extensions.prf` on create accepts `{ eval: { first, second? } }`; output is `{ enabled, results: { first, second? } }`. (On a non-bucket-4 device you get `{ enabled: false }` and no `results` — then see §6.) ([W3C explainer](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md); [MDN extensions → prf](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions); [oblique](https://oblique.security/blog/passkey-prf)).

Resident/discoverable requirements: `residentKey: "required"` (+ legacy `requireResidentKey: true`) guarantees a passkey you can later summon usernameless by omitting `allowCredentials`. If the device can't make one you get `NotSupportedError`. ([web.dev — discoverable credentials](https://web.dev/articles/webauthn-discoverable-credentials)).

### 4.2 Unlock: PRF → HKDF → AES-GCM vault key

```js
// salt comes from IndexedDB; challenge is random (nobody verifies it offline)
async function unlock() {
  const salt = await loadSalt();                       // Uint8Array(32), stored at setup
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const cred = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: "spectre.example.com",
      allowCredentials: [],            // empty => discoverable usernameless prompt; PRF returns for SELECTED credential
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  const out = cred.getClientExtensionResults();
  if (!out.prf || !out.prf.results || !out.prf.results.first)
    throw new Error("PRF not available on this device");
  const prfOut = new Uint8Array(out.prf.results.first);            // 32 bytes, deterministic per (credential, salt)

  const Ik = await crypto.subtle.importKey("raw", prfOut, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF", hash: "SHA-256",
      salt: new TextEncoder().encode("spectre/vault/v1"),          // app context, not secret
      info: new TextEncoder().encode("vault-aes-gcm"),
    },
    Ik,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}
```
Then `crypto.subtle.decrypt({name:"AES-GCM", iv}, vaultKey, vaultCiphertext)` opens the vault. AES-GCM **iv/nonce uniqueness is your job** — never reuse an iv under the same key (PRF gives you zero protection against nonce reuse). ([hakhub](https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/); [W3C explainer — nonce note](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md)).

**Key rotation** (the `second` salt): supply `{ first: saltNow, second: saltNext }`; `first` decrypts the bytes written last session, `second` encrypts today; next session `saltNext` moves to `first`. Bounds the value of a compromised salt. ([W3C explainer](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md); [MDN extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)).

### 4.3 The pattern to actually ship: envelope encryption + recovery code

Directly using the PRF-derived key as the vault key makes the **whole vault** hostage to one passkey. Instead:

```
PRF(passkey, salt) ──HKDF──> KEK_A        (per passkey A)
recovery code      ──HKDF──> KEK_rec
DEK (random 32B)  ──wrapped by KEK_A , KEK_rec ──> store wrapped copies in IndexedDB
vault data        ──AES-GCM(DEK)──> stored locally
```

Setup: generate `DEK`; store `wrapKey(DEK, KEK_A)` and `wrapKey(DEK, KEK_rec)`; encrypt real data under DEK. Unlock: PRF→KEK_A→`unwrapKey`→DEK→vault. Recovery: type the code→KEK_rec→DEK. This is the structure the spec community endorses and Bitwarden/1Password ship (Bitwarden adds a 2nd RSA layer; 1Password adds a device key). ([lilting — Envelope Encryption](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk); [Bitwarden deep-dive](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/)).

### 4.4 `evalByCredential` (multiple passkeys in one `get()`)

When you show a modal selector and pass explicit `allowCredentials: [credA, credB]`, use `extensions.prf.evalByCredential = { [credIdA]: {first: salt}, [credIdB]: {first: salt} }` so each listed credential gets its own evaluation. `eval` and `evalByCredential` are mutually exclusive; `evalByCredential` requires non-empty `allowCredentials`. ([MDN extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions)).
Cleaner for a vault: keep **one** passkey (userHandle = your vault) and omit `allowCredentials`.

---

## 5. Offline + serverless reality (Chrome Android)

- **`get()` with a platform authenticator is fully local.** The passkey's private key lives on the device (GPM encrypts it at rest with a hardware-protected key; use only needs a screen lock/biometric). Signature generation, user verification, and PRF evaluation all happen locally — no network required. ([Google security blog — GPM at rest](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html); per-platform FAQ "local authentication can work offline, syncing needs internet" e.g. [Paubox](https://www.paubox.com/blog/windows-11-adds-third-party-passkey-manager-support)).
- **The one network dependency is *first arrival* of the passkey on that device.** GPM passkeys are synced and E2EE: on a brand-new device, the first-time restore of the E2EE keys to decrypt the passkey requires being online (Google Account + possibly another device's screen lock). Once the passkey exists on the device it authenticates offline. ([Google security blog — recovery](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html)). For an offline-only PWA that means: "get the passkey onto the device while online, then it works forever offline."
- **`create()` offline:** Chrome allocates the new credential locally with GPM; sync happens later when connectivity returns. Supported, but plan for it and verify on device.
- **Cross-device / "use another device" / QR flows DO need network + Bluetooth** — avoid for an offline vault; enforce `authenticatorAttachment: "platform"` and detect/disable the "another device" path. ([passkeys.dev](https://passkeys.dev/device-support/)).
- No server means **nothing ever verifies the assertion**; keep the challenge random anyway (browser hygiene, avoids signature-collision edge cases).
- **2026 security footnote:** Unit 42's "Pass-ta-key" demonstrated that an attacker who already has code on a desktop Chrome sitscher can lift GPM's synced-data master key from process memory (no revoke path). With a *local-only* vault the PRF key is still one prompt away for malware on the device — same threat model as any local E2EE. ([lilting update 2026-08-05](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)).

---

## 6. Fallback when PRF is unsupported

On Chrome Android ≥130 + GPM, PRF is effectively ubiquitous, but you still need an off-ramp (Android Firefox, third-party providers without PRF, and — most importantly — old/roaming authenticators and deleted passkeys).

What real products do:
- **Bitwarden: master password (or PIN) fallback.** Passkey still used for authentication; the human-provided secret decrypts. Their docs say "only when all members of the ceremony support PRF can Bitwarden obtain the key." ([Bitwarden Help](https://bitwarden.com/help/login-with-passkeys); [contributing docs](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/)).
- **1Password: unlock with passkey uses a separately generated, wrapped "device key"; the classic Account Password + Secret Key remains the recovery path.** ([1Password blog](https://1password.com/blog/encrypt-data-saved-passkeys)).
- **Typed recovery code**: best fit for a password-free local vault — 16-word code → PBKDF2/HKDF → KEK that unwraps a stored DEK (see 4.3). Bitwarden publishes a "security readiness kit" analog; 1Password leans on Secret Key. This is the "recovery code" answer to the passkey-loss problem.
- **Attestation-based wrap: not usable.** `get()` doesn't hand back signing attestation, and attestation is device-scoped (one key for the whole device), not credential-scoped — useless for per-vault decryption. Don't design for it.
- **Passkey-signature-as-key: do not do it.** The idea (sign a fixed challenge → deterministic signature → hash it → key) breaks because authenticators emit randomized ECDSA; nothing guarantees RFC-6979 determinism, and there's no API contract for it. W3C guidance explicitly says WebAuthn signatures/authenticatorData/public keys are *not* valid secret material. If you need a no-PRF path, use a typed recovery code or escrowed, wrapped DEK. ([hakhub](https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/)).
- **Contract-level recommendation from the ecosystem:** treat PRF as an enhancement, keep the recovery path, and feature-detect it (`prf.enabled`, presence of `results`) rather than assuming. ([Corbado §9-10](https://www.corbado.com/blog/passkeys-prf-webauthn)).

---

## 7. Requirements checklist (Chrome Android PWA)

| Requirement | Status / how to satisfy | Source |
|---|---|---|
| Secure context (https) | Required by WebAuthn; PWA is served once over https at install. After install the offline origin stays an https secure context. | [MDN WebAuthn](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API) |
| Discoverable / resident credential | `authenticatorSelection.residentKey:"required"` (+`requireResidentKey:true`); then usernameless `get()` with `allowCredentials:[]`. | [web.dev](https://web.dev/articles/webauthn-discoverable-credentials) |
| Usernameless get() offline | Works with platform authenticator + GPM (local, see §5); returns PRF for the selected credential. | [Google](https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html); [Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn) |
| User gesture | `create()`: Chrome requires transient user activation | call from a tap/button. `get()`: not strictly required by Chrome (Safari was the gesture-enforcing browser), but 'immediate' mediation does require one — keep unlock behind a button. | [Chrome immediate mediation](https://developer.chrome.com/blog/webauthn-immediate-mediation-ot); [Corbado Safari gestures](https://www.corbado.com/blog/safari-webauthn-user-activated-events) |
| Autocreation of creds at first run | Possible offline (bucket-4 GPM returns PRF at create), but still needs a user gesture; don't auto-fire without a button. | [Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions) |
| Offline storage of salt & wrapped keys | IndexedDB (localStorage is synchronous/small). Salt is not secret; wrapped DEKs are. | — |
| Challenge | Local `crypto.getRandomValues(32)`. No server, nothing to prove. | — |
| iv/nonce uniqueness | Your responsibility under AES-GCM. | [hakhub](https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/) |

---

## 8. PWA / WebView caveats (Chrome Android)

- **Installed PWA (Add to Home Screen) = the same Chrome engine, same origin, same profile.** `navigator.credentials` behaves identically to a tab; the standalone window does not break rpId, PRF, or the GPM sheet. This is the supported deployment for the vault. (The PWA requirement of https + service worker for install is standard.) ([Chrome PWA docs](https://developer.chrome.com/blog/improved-pwa-offline-detection/)).
- **Iframes:** WebAuthn (incl. PRF) works in *same-origin* iframes freely; *cross-origin* iframes are blocked by default and need `allow="publickey-credentials-get"` (`Permissions-Policy: publickey-credentials-get`) **plus** the frame having a user gesture. Keep the vault UI in the top-level document. ([W3C explainer](https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md); [MojoAuth](https://mojoauth.com/blog/known-broken-passkey-combinations-and-workarounds); [MDN Permissions-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/publickey-credentials-get)).
- **Android WebView / in-app browsers:** `navigator.credentials.publicKey` is **not** available in a stock Android WebView or social-app in-app browsers (Instagram/TikTok/Facebook) without a dedicated Credential-Manager-for-WebView bridge and Android App Links verification. A **TWA ("Trusted Web Activity") is a WebView** — treat TWA-installed PWAs as unsupported for WebAuthn/PRF and do NOT rely on them. Ship the vault as a normal browser-installed PWA. ([MojoAuth broken combos](https://mojoauth.com/blog/known-broken-passkey-combinations-and-workarounds); [reddit/webauthn WebView](https://www.reddit.com/r/webauthn/comments/1d3yjo5/using_webauthn_in_an_inapp_browser_or_any_webview/)).
- **rpId trap:** `rp.id` must be a registrable-domain suffix of the origin (e.g. `tukachev.dev`, not `*.vercel.app` or a subdomain you don't control). Root-delegation preview hosts break credential scoping; use the final domain. ([MojoAuth](https://mojoauth.com/blog/known-broken-passkey-combinations-and-workarounds) — SecurityError on rp.id).

---

## 9. Risks & gotchas worth writing down

1. **Passkey loss = vault loss** (unless you ship a recovery code / envelope). Cappalli's "Erika" scenario: user deletes the passkey from the credential manager UI that shows no encryption usage → data gone. ([lilting](https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk)). Ship envelope encryption + recovery code + a clear passkey-loss path.
2. **Multiple passkeys ⇒ multiple PRF keys.** If you ever permit a second passkey, the vault must be unwrapable by each (wrap DEK per credential), else the second passkey can't open the vault.
3. **Passkey deletion is not the only death:** Chrome profile wipe, remove-screen-lock, GPM account removal, "clean up" tools. Same recovery-code answer applies.
4. **Don't reuse salts across users/installs carelessly** — determinism is a feature, but a public salt means anyone who can run the passkey gets the key (that's the point here: possession + biometric).
5. **Safari-era iOS bugs (18.0–18.3 data-loss in cross-device PRF)** are a reminder to test on the exact device/OS matrix you claim support for; Android+GPM is stable. ([Corbado](https://www.corbado.com/blog/passkeys-prf-webauthn)).
6. **`prf` option is per-credential key material, treated as credential secrets by providers.** GPM/Apple provision hmac-secret per credential, so each passkey you create for this RP gives a fresh independent key. Don't cache PRF output outside WebCrypto non-extractable keys if you can avoid it (use `extractable:false`).

---

## 10. Sources

Specs & explainers
- W3C WebAuthn Level 3 (CR snapshot 2026-05-26), PRF extension — https://www.w3.org/TR/webauthn-3/
- W3C PRF extension explainer — https://raw.githubusercontent.com/w3c/webauthn/main/explainers/prf-extension.md (and wiki mirror https://github.com/w3c/webauthn/wiki/Explainer:-PRF-extension)
- MDN — Web Authentication extensions (incl. `prf` input/output shapes) — https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions
- w3c/webauthn issue #1830 (hmac-secret ⇄ passkey PRF; emlun's answers) — https://github.com/w3c/webauthn/issues/1830
- web.dev — Discoverable credentials deep dive — https://web.dev/articles/webauthn-discoverable-credentials

Browser / platform status (2026)
- Chrome Platform Status — WebAuthn PRF extension — https://chromestatus.com/feature/5138422207348736
- Blink Intent to Ship: WebAuthn PRF extension — https://groups.google.com/a/chromium.org/g/blink-dev/c/iTNOgLwD2bI
- passkeyprf.com support matrix (Chrome/Edge ≥128, Chrome Android ≥130, GPM, 1Password, Bitwarden) — https://www.passkeyprf.com/
- Corbado — Passkeys & WebAuthn PRF for E2EE (2026; updated 2026-08-03; Android/GPM support table, buckets, retrofitting, recovery) — https://www.corbado.com/blog/passkeys-prf-webauthn
- hakhub — Pulling Encryption Keys Out of Passkeys with PRF (2026-07-03; 2026 snapshot, "signatures aren't key material") — https://blog.hakhub.net/en/blog/webauthn-prf-passkeys/
- passkeys.dev device-support matrix — https://passkeys.dev/device-support/
- Google for Developers — Passkey support on Android and Chrome — https://developers.google.com/identity/passkeys/supported-environments

Platform authenticator / crypto facts
- Google Security Blog — Security of Passkeys in the Google Password Manager (E2EE, at-rest hardware encryption, screen lock, recovery) — https://security.googleblog.com/2022/10/SecurityofPasskeysintheGooglePasswordManager.html
- Yubico — PRF Extension developer guide — https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html
- Microsoft Learn — Support for Passkeys in Windows (offline local auth context) — https://learn.microsoft.com/en-us/windows/security/identity-protection/passkeys/

Product implementations
- Bitwarden contributing docs — Passkeys for decryption (HKDF stretch, RSA wrap, fallback) — https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/
- Bitwarden Help — Log in & Unlock with Passkeys (PRF requirements, master-password fallback) — https://bitwarden.com/help/login-with-passkeys
- Bitwarden blog — PRF WebAuthn and its role in passkeys — https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/
- BleepingComputer — Bitwarden passkey/PRF implementation detail — https://www.bleepingcomputer.com/news/security/bitwarden-adds-passkey-support-to-log-into-web-password-vaults
- 1Password blog — 1Password can now encrypt data using your saved passkeys — https://1password.com/blog/encrypt-data-saved-passkeys
- 1Password open-source passkey-rs — https://github.com/1Password/passkey-rs
- WhatsApp — Encrypting your WhatsApp chat backup just got easier — https://blog.whatsapp.com/encrypting-your-whatsapp-chat-backup-just-got-easier
- ghacks — WhatsApp Chat Backup now supports Passkeys — https://www.ghacks.net/2025/11/03/whatsapp-chat-backup-now-supports-passkeys-to-encrypt-data
- Oblique — Passkey PRFs for end-to-end encryption — https://oblique.security/blog/passkey-prf
- Confer — Passkey encryption — https://confer.to/blog/2025/12/passkey-encryption/
- lilting — Do not use Passkeys' PRF to derive encryption keys (Cappalli warning, envelope encryption, passkey-loss blast radius, Pass-ta-key) — https://lilting.ch/en/articles/passkeys-prf-extension-encryption-risk

Gestures / iframes / WebView
- caveat on gestures: Chrome immediate-mediation OT (user-gesture requirement) — https://developer.chrome.com/blog/webauthn-immediate-mediation-ot
- Corbado — Safari WebAuthn user-gesture history — https://www.corbado.com/blog/safari-webauthn-user-activated-events
- MojoAuth — known broken passkey combos (WebView, cross-origin iframe, rpId) — https://mojoauth.com/blog/known-broken-passkey-combinations-and-workarounds
- MDN Permissions-Policy: publickey-credentials-get — https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/publickey-credentials-get
- Reddit r/webauthn — WebAuthn in WebView / in-app browsers — https://www.reddit.com/r/webauthn/comments/1d3yjo5/using_webauthn_in_an_inapp_browser_or_any_webview/
- Chrome blog — Improving PWA offline support detection (PWA/offline expectations) — https://developer.chrome.com/blog/improved-pwa-offline-detection/
- StackOverflow — PRF vs hmacCreateSecret on Chrome 130 — https://stackoverflow.com/questions/79169689/encrytion-with-passkeys-prf-extension-and-hmaccreatesecret-extension-which-on
- SimpleWebAuthn discussion — WebAuthn for offline authentication — https://github.com/MasterKale/SimpleWebAuthn/discussions/305