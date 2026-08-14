---
id: N10
title: Land lint + format
type: task
status: closed
blocked_by: [N5]
assigned: dev
---

> **REDO (2026-08-13):** the ESLint+Prettier landing below is **superseded** — the human chose the Oxc toolchain. Per the revised N5 resolution, remove the ESLint/Prettier/nabla setup and land **oxlint + oxfmt + vite-plugin-oxlint** instead. A new `## Resolution (Oxc)` section will replace this ticket's earlier ESLint `## Resolution`.

## Question

Manual setup for the stack N5 chooses: install and configure lint + format per N3's facts.

- ESLint (flat config, `eslint-vite`, `eslint-plugin-solid`) + Prettier (`prettier-plugin-tailwindcss`), or Biome if N5 picks it.
- Wire `npm run lint` / `npm run format` (+ fix modes); decide with N5 whether they gate build/test.
- Apply to the existing `src/` + `tests/`; resolve pre-existing violations (the 527-line `App.tsx` will be a lint hotspot — record whether it needs suppression until the navigation work lands).
- Resolved when lint and format pass cleanly on the current tree. Record config + packages in the resolution.

## Resolution

Landed 2026-08-13, exactly per N5 (ESLint + Prettier + `@nabla/vite-plugin-eslint` dev overlay). `npm run lint`, `npm run format`, `npm test` (32/32), and `npm run build` are all green on the current tree.

### Packages (devDependencies)

- `eslint` **`9.39.5`** (EXACT pin — peer-capped at ^9 by eslint-plugin-solid; 9 is EOL, upgrade tracked by solidjs-community/eslint-plugin-solid#203/#207).
- `eslint-plugin-solid` `^0.14.5` (peer `eslint ^6–^9` satisfied; no peer hack needed).
- `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin` `^8.67.0` (ESLint-9 compatible; not type-checked mode).
- `@eslint/js` `^9.39.5` (for `js.configs.recommended`) and `globals` `^16.5.0` (browser+node globals) — added beyond the N5 list because the flat config needs them.
- `prettier` **`3.9.6`** (EXACT pin per prettier.io) + `prettier-plugin-tailwindcss` `^0.8.1`.
- `@nabla/vite-plugin-eslint` `^3.0.1` — peer `eslint ^9||^10`, `vite ^4–^8`.

**Type-aware config — not used, and not needed.** N3 assumed `solid/reactivity` is type-aware, but the plugin (verified from its dist bundle) uses **no parser services at all** — all 20 rules are structural. `configs/typescript` only sets `solid/jsx-no-undef: [2, {typescriptEnabled: true}]`. So `parserOptions.project` was skipped entirely, which also dodges the tsconfig split (`tsconfig.app.json` for src vs `tsconfig.node.json` for vite configs, plus tests living outside both).

### Config files

- **`eslint.config.js`** (flat): global `ignores` (`dist/**`, `node_modules/**`, `public/**`, `.playwright-mcp/**`, `.wayfinder/**`, `.wrangler/**`, `crates/**`, `src/lib/spike/**` wasm-generated output, `index.html`, `spike.html`, `wrangler.toml`); `files: ['**/*.{ts,tsx}']` block with `@typescript-eslint/parser`, browser+node globals, `@typescript-eslint` recommended rules (base `flat/recommended` [1]+[2] spread), then `eslint-plugin-solid/configs/typescript` scoped to the same files; a `.js` block applying `js.configs.recommended` with node globals (covers `eslint.config.js` itself).
- **`.prettierrc.json`**: `{ "semi": false, "singleQuote": true, "plugins": ["prettier-plugin-tailwindcss"], "tailwindStylesheet": "./src/index.css" }` — repo convention + the Tailwind-v4-required stylesheet option.
- **`.prettierignore`**: mirrors the eslint ignores plus `package-lock.json` and `CONTEXT.md` (see notes).
- **`vite.config.ts`**: `eslint()` added to `plugins` — `@nabla/vite-plugin-eslint` is dev-server-only, async, non-blocking, cannot fail the build (verified `npm run build` and a `vite dev` smoke test). It writes `.eslintcache` in serve mode → added to `.gitignore`.

### Violations found (App.tsx was NOT a hotspot)

N3 predicted `App.tsx` (527 lines) would be a lint hotspot. Actual eslint-plugin-solid run: **zero findings in App.tsx** — it already uses `class`, `<For/>`/`<Show/>`, no props destructuring, no innerHTML/style strings. No disable-comments and no suppression needed there. Two real violation clusters:

- `src/spike.tsx` — **21× `solid/style-prop`** (string `style="…"` props on the throwaway S4 iroh spike page). Autofixed by `eslint --fix` (behavior-preserving: string → object style), then prettier-formatted. No logic touched.
- `src/lib/vault/useVault.ts:121` — **1× `solid/reactivity`** false positive: `prefs()` is read inside the `withBusy(async …)` callback, which Solid never tracks across `await` (value captured at call time on purpose). Not fixable without restructuring the code, so a targeted `// eslint-disable-next-line solid/reactivity` with a 4-line reason comment was added. Only disable-comment in the repo.

Also of note: `solid/imports` did **not** warn on `@solidjs/web` in `src/index.tsx` (N3 predicted a warning from the stale Solid-1 package map) — the rule tolerates it.

### Scripts

`lint` = `eslint .`, `lint:fix` = `eslint . --fix`, `format` = `prettier --check .`, `format:fix` = `prettier --write .`. Separate from `build`/`test` — not a gate, per N5.

### Notes / follow-ups

- **`.npmrc` `legacy-peer-deps=true` untouched** (owned by N9). This install was clean without exercising it: `eslint@9.39.5` satisfies the plugin's `^6–^9` peer range and typescript-eslint v8's `^8.57 || ^9`; `npm ls` shows a fully deduped, valid tree.
- `format:fix` reformatted `src/` + `tests/` + `vite.config.ts`/`vitest.config.ts` (large but purely formatting diff; tailwind classes reordered, cosmetic per N3).
- `CONTEXT.md` added to `.prettierignore` — it's the sync effort's actively-edited WIP doc and Prettier's markdown pass (blank lines after headings, `*x*`→`_x_`) churns it; out of lint/format scope.
- `src/lib/spike/**` (wasm-bindgen output) ignored by both eslint and prettier.
- The `__dirname` deprecation warning in `vite.config.ts` (Vite 8 native config loader) is pre-existing and unrelated; fixing it (`import.meta.dirname`) is a trivial follow-up.

---

## Resolution (Oxc) — REDO 2026-08-13 (supersedes the ESLint+Prettier `## Resolution` above)

Landed exactly per the revised N5: **oxlint + oxfmt + vite-plugin-oxlint**, Solid rules via the JS-plugin layer, Tailwind v4 class sorting via oxfmt's `sortTailwindcss`. All gates green on the current tree: `npm run lint` (0 warnings, 0 errors), `npm run format` clean, `npm test` 32/32, `npm run build` green, `vite dev` smoke-tested (overlay logs "Oxlint successfully finished").

### Packages (devDependencies)

- `oxlint` `^1.78.0` — linting (stable 1.x).
- `oxfmt` **`0.63.0`** (EXACT pin — 0.x beta, weekly breaking minors; package.json pins it precisely, no `^`).
- `vite-plugin-oxlint` `^2.1.2` — dev/build overlay (peer `vite >=5`, works on Vite 8). `configFile: '.oxlintrc.json'` set explicitly (plugin default is dotless `oxlintrc.json`); no `failOnError` — non-failing overlay, standalone CLI scripts are the gate.
- `eslint-plugin-solid` **`0.14.5`** (exact) — via `jsPlugins`.
- `eslint` `^9.39.5` — **inert, but required**: eslint-plugin-solid's dep `@typescript-eslint/utils` imports `eslint` at load time (`FlatESLint.js`). Because the repo `.npmrc` has `legacy-peer-deps=true` (owned by N9, untouched), npm does **not** auto-install the `^6–^9` peer, so without an explicit devDep the JS plugin fails to load ("Cannot find module 'eslint'"). eslint is never invoked by any script; `npm ls` shows it only as the plugin's peer. The `.npmrc` caveat means the N5 expectation "eslint auto-appears as an inert peer" does not hold here — it had to be installed explicitly.
- **Removed** (superseded): `@eslint/js`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `globals`, `prettier`, `prettier-plugin-tailwindcss`, `@nabla/vite-plugin-eslint`. (`fake-indexeddb` was already gone from the tree before this task.)

### Config files

- **`.oxlintrc.json`** — `plugins: ["eslint","typescript","unicorn","oxc","import","vitest"]` (plugins key overwrites the default set, so the four defaults are re-listed); `categories: { correctness: warn, suspicious: warn }`; `jsPlugins: ["eslint-plugin-solid"]`; the N5 solid structural set (`no-destructure`, `prefer-for`, `jsx-no-duplicate-props`, `jsx-no-undef`+typescriptEnabled, `jsx-uses-vars`, `no-innerhtml` → error; `components-return-once`, `event-handlers`, `reactivity` → warn; `no-unknown-namespaces` → off); `ignorePatterns` as in N5 research (f) incl. `src/lib/spike/**`, `index.html`, `spike.html`, `wrangler.toml`; overrides for `**/test/**`/`**/tests/**` with `env.vitest`.
  - Two rule options added during triage: `eslint/no-underscore-dangle: ["warn", { "allow": ["_tag"] }]` (Effect tagged-union convention) and `import/no-unassigned-import: ["warn", { "allow": ["**/*.css"] }]` (Vite CSS side-effect imports).
- **`.oxfmtrc.json`** — `printWidth: 80` (oxfmt default is 100), `semi: false`, `singleQuote: true`, `trailingComma: "all"`, `sortTailwindcss: { "stylesheet": "./src/index.css" }` (replaces `prettier-plugin-tailwindcss`), `ignorePatterns` mirrors N5 research (f) plus `package-lock.json` and `CONTEXT.md`. `sortPackageJson` is on by default → package.json key/dep order changed in the format commit (expected).

### Files deleted / rewired

- Deleted: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, and the stale `.eslintcache` (plus its now-dead `.gitignore` entry — the nabla overlay that wrote it is gone).
- `vite.config.ts`: `@nabla/vite-plugin-eslint` import + `eslint()` entry removed; `vite-plugin-oxlint` added as `oxlint({ configFile: '.oxlintrc.json' })` (non-failing overlay).

### Scripts (separate from build/test, not a gate)

`lint` = `oxlint`, `lint:fix` = `oxlint --fix`, `format` = `oxfmt --check`, `format:fix` = `oxfmt`.

### Findings / triage (App.tsx was NOT a hotspot, again)

App.tsx needed **zero** rule disables — it is idiomatic Solid (class, `<For/>`/`<Show/>`, no props destructuring, no innerHTML). The 14 initial oxlint findings were all native correctness/suspicious rules, not Solid:

- 5× `eslint/no-useless-constructor` — genuinely redundant `constructor(message){ super(message) }` in the Error subclasses (`CryptoError`, `PasskeyError`, `VaultStorageError`×2, `VaultUnlockedError`); **removed** (behavior-preserving).
- 4× `unicorn/prefer-add-event-listener` — IDB one-shot handlers (`req.onsuccess`/`req.onerror`) in `storage.ts` ×2 and browser tests ×2; **converted** to `req.addEventListener('success'/'error', …)`.
- 2× `eslint/no-underscore-dangle` on `bad._tag` (tests) — Effect convention, fixed via config `allow: ["_tag"]`; 1× on `__spikeNode` (`src/spike.tsx`) — targeted `// oxlint-disable-next-line eslint/no-underscore-dangle` with reason.
- 1× `import/no-unassigned-import` on `import './index.css'` — Vite side-effect import, fixed via config `allow: ["**/*.css"]`.
- 1× `import/no-named-as-default` on `src/spike.tsx` wasm import — wasm-bindgen emits default + named `initSync`; targeted `// oxlint-disable-next-line import/no-named-as-default` with reason (matches the prior eslint run's pattern).

Net disable-comments in the repo: **3** (the pre-existing `solid/reactivity` one in `useVault.ts`, now confirmed honored by oxlint, plus the two spike.tsx ones above).

### Notes / follow-ups

- **`solid/reactivity` degradation — confirmed as expected.** The rule *does* run under oxlint's JS-plugin runtime (verified against a synthetic pattern: fires, and `// eslint-disable-next-line solid/reactivity` suppresses it), but it is structural-only here — oxlint's JS-plugin API provides no TS type-awareness, so the type-driven reactivity diagnostics eslint-plugin-solid offers under ESLint are unavailable. Accepted per N5.
- **`solid/imports` — not an issue.** It was never enabled (jsPlugins rules default to off; the config enables an explicit list), so the Solid-2 `@solidjs/web` package-map staleness cannot error. `src/index.tsx`'s `import { render } from '@solidjs/web'` lints clean.
- **`.npmrc` `legacy-peer-deps=true`** — untouched (owned by N9) and *not relied on*; it is precisely why `eslint` had to be added as an explicit inert devDep (see Packages).
- **oxfmt is 0.x beta** — exact-pinned `0.63.0`; do not blanket-upgrade. A future minor may reformat the tree (research N5 §c: breaking formatter changes in minors). `--check` in CI is the safe usage.
- `format:fix` was a large but purely formatting pass: App.tsx (printWidth-80 wrapping, object/import expansion), Tailwind class re-sort (custom classes like `tap` sort ahead of known utilities), and the `sortPackageJson` reorder of package.json.
- The `__dirname` warning in `vite.config.ts` (Vite 8 native config loader) is still pre-existing and unrelated.
