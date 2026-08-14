# N3 — Lint + format stack facts for this deployment

> Research ticket N3 · wayfinder routing map · researched 2026-08-13 (AFK web research)
> Feeds N5 (tooling choice) and N10 (land it). All versions/dates checked against npm, GitHub, biomejs.dev, eslint.org, prettier.io, tailwindcss.com on 2026-08-13.

## TL;DR

- **"eslint-vite" does not exist as an official ESLint plugin.** The npm name `eslint-vite` is a **security holding package** (0.0.1-security, placeholder published after malicious code was removed). The `eslint` GitHub org has **zero** Vite repositories, and `github.com/eslint/eslint-vite` 404s. The human's "official ESLint Vite plugin" belief (`.wayfinder/routing/map.md`) is a misconception. The real options are community Vite plugins (`@nabla/vite-plugin-eslint`, `vite-plugin-eslint2`) — or simply **running ESLint as its own process**, which is what ESLint itself recommends.
- **ESLint version matters right now:** ESLint 9 reached **EOL on 2026-08-06** (no more maintenance); current is **10.8.1** (2026-08-07). But the released **eslint-plugin-solid 0.14.5 (2024-12-11) declares peer `eslint ^6||^7||^8||^9`** — ESLint 10 support is an **approved-but-unmerged PR** (#207, approved 2026-07-30). This is the single biggest friction point for the human's preferred stack.
- **Solid 2 beta friction:** eslint-plugin-solid is AST-based and mostly version-agnostic, but its `solid/imports` rule is stale for Solid 2's package moves (`solid-js/web` → `@solidjs/web`; `solid-js/store` → `solid-js`). This repo imports `render` from `@solidjs/web` (`src/index.tsx:1`).
- **Prettier 3.9.6 + prettier-plugin-tailwindcss 0.8.1** fully support Tailwind v4, but **require the `tailwindStylesheet` option** pointing at the CSS entrypoint (`src/index.css` here). Tailwind v4 ordering is purely cosmetic (class order no longer affects cascade).
- **Biome is a much stronger alternative than the ticket assumed:** current **2.5.8** (2026-08-04), **500+ rules, now with native SolidJS rules** (`noSolidDestructuredProps` recommended, `noReactSpecificProps` recommended, `useSolidForComponent` opt-in) plus a community GritQL plugin. It is a single binary for lint+format+import-organize, ~97% Prettier-compatible, dramatically faster than ESLint. Its gaps: **no Tailwind class sorting** and fewer/finer Solid reactivity rules than eslint-plugin-solid.

**Recommendation to carry into N5:** ESLint 10 flat config + typescript-eslint + eslint-plugin-solid + Prettier (with `prettier-plugin-tailwindcss`), **run standalone from Vite** (no `eslint-vite`), with the plugin's ESLint-10 peer gap handled explicitly (option 1: pin `eslint@9.39.5`; option 2: install `eslint@10` + plugin with npm `legacy-peer-deps` and track solidjs-community/eslint-plugin-solid#203/#207; option 3: wait for the plugin release). Biome is the credible single-tool fallback if the peer friction is unacceptable, with the Tailwind-sorting gap accepted.

---

## (a) `eslint-vite` / ESLint × Vite integration — status

### The name is taken by a security placeholder
- npm `eslint-vite` **0.0.1-security** — "This package contained malicious code and was removed from the registry by the npm security team. A placeholder was published…" (npm page, fetched 2026-08-13; verified via `npm view eslint-vite versions` → `["0.0.1-security"]`). **Do not install.**
- `github.com/eslint/eslint-vite` → **404**. `github.com/orgs/eslint/repositories?q=vite` → **0 repositories**. There is no official ESLint Vite plugin published by the ESLint team.

### What actually exists (all community)
| Package | Version / date | Peer support | Notes |
|---|---|---|---|
| `vite-plugin-eslint` (gxmari007) | 1.8.1, **last published 2022-08-16** | eslint ≥7, vite ≥2 | unmaintained; blocks dev-server transform; not recommended |
| `@nabla/vite-plugin-eslint` (Arnaud Barré, a.k.a. ArnaudBarre) | 3.0.1 (2026-03-18) | **eslint `^9 \|\| ^10`, vite `^4 \|\| ^5 \|\| ^6 \|\| ^7 \|\| ^8`** (npm peerDeps, verified) | dev-server only, async + non-blocking (keeps HMR fast), cannot fail the build; eslintcache |
| `vite-plugin-eslint2` (ModyQyW) | 5.3.0 (2026-06-23) | vite v2–v8, eslint v7–v10 | maintained fork of the original; runs at serve+build |
| `vite-plugin-checker` (fi3ework) | ~1.2k★, active | TS / ESLint / stylelint overlay | orthogonal — type + lint overlay in the dev server |

Source: npm registry pages + registry.vite.dev (Vite's plugin registry, launched with Vite 8).

### How this differs from running eslint directly
- `eslint-vite`-style plugins re-run ESLint from the dev server; the main cost is re-linting on every transform, so the good implementations (nabla) lint asynchronously and only in `serve` mode. ESLint's own docs treat **linting as its own process** (CLI script, editor, CI) — the Vite integrations page is a list of *community* projects and the official guidance is a plain `eslint` invocation.
- Editor integration is independent of Vite: the **VS Code ESLint extension** (Microsoft `vscode-eslint`) supports flat config and auto-fix on save; "Use Flat Config" is enabled by default since ESLint 9.
- **Vite 8 compat:** Vite 8 (stable 2026-03-12, per vite.dev/blog/announcing-vite8) ships **Rolldown** as its single Rust bundler with a compatibility layer for existing plugins; `@nabla/vite-plugin-eslint` already declares `vite ^8` peer. But this repo doesn't need any of it.

**Friction summary:** no official plugin exists; the map's "`eslint-vite`" should be re-worded to "ESLint as a standalone script (optionally + `@nabla/vite-plugin-eslint` for a dev overlay)". Recommendation: standalone script — one less moving part in a tiny repo.

---

## (b) `eslint-plugin-solid` + shared config

### Versions / package facts
- Latest published: **0.14.5** (2024-12-11), **pre-1.0.0** ("approaching 1.0.0"). npm verified.
- `peerDependencies`: `eslint ^6.0.0 || ^7.0.0 || ^8.0.0 || ^9.0.0`, `typescript >= 4.8.4`. **No `^10` yet.** (npm verified 2026-08-13.)
- Runtime dep: `@typescript-eslint/utils ^7.13.1 || ^8.0.0` — this is what breaks on ESLint 10 (see below).

### ESLint 10 support — the open gap
- Issue **#203 "ESLint v10 Support"** (2026-02-10) — open, assigned to maintainer joshwilsonvu.
- PR **#207 "Add eslint v10 support"** (codylindley; reviewed by rtritto; **approved by 43081j 2026-07-30; still OPEN/unmerged as of 2026-08-13** — waiting on merge, CI never ran on the fork). Key technical findings in the PR:
  - `@typescript-eslint/utils` **≥ 8.56.0** is required for ESLint 10 (first release declaring an `eslint ^10` peer; older utils reference `LegacyESLint`, which ESLint 10 removed → `Class extends value undefined`).
  - `@babel/eslint-parser@7` cannot run on ESLint 10 (v8 of the parser + `@babel/core@8` required).
  - The PR's test suite passes all parser variants on ESLint 10 with `@typescript-eslint/* ≥ 8.56.0`.
- Consequence for install: `npm i eslint@^10 eslint-plugin-solid@0.14.5` **errors with ERESOLVE** (peer range mismatch) unless you use `--legacy-peer-deps` / `.npmrc legacy-peer-deps=true` (npm) or `peerDependencyRules.allowedVersions` (pnpm). Workarounds: (1) pin `eslint@9.39.5` (last v9, but v9 is **EOL since 2026-08-06** — no maintenance), (2) accept the peer hack on ESLint 10 and track #203/#207, or (3) wait for the release.

### Flat config support — yes
Both shared configs ship **in the plugin** (there is no separate first-party "eslint-config-solid"): `eslint-plugin-solid/configs/recommended` and `eslint-plugin-solid/configs/typescript`; also `plugin.configs['flat/recommended']` and `plugin.configs['flat/typescript']`. The `typescript` config expects `@typescript-eslint/parser` with `parserOptions.project` (type-aware). (npm README, github README.)
- Note: the "eslint-config-solid" on npm is **`@pxeeio/eslint-config-solid`** — a stale third-party eslintrc package (last pub 2023), not the Solid team's. Ignore it.

### Rules (0.14.x)
Recommended (from plugin README/rules table): `components-return-once` (🔧), `event-handlers` (🔧), `imports` (🔧), `jsx-no-duplicate-props`, `jsx-no-script-url`, `jsx-no-undef` (🔧), `jsx-uses-vars`, `no-destructure` (🔧), `no-innerhtml` (🔧), `no-react-deps` (🔧), `no-react-specific-props` (🔧, **warn**), `no-unknown-namespaces`, `prefer-for` (🔧), `reactivity` (the flagship type-aware rule), `self-closing-comp` (🔧), `style-prop` (🔧). Non-recommended: `no-array-handlers`, `no-proxy-apis`, `prefer-classlist` (🔧), `prefer-show` (🔧).
- There is no rule literally named "no-extra-reactive-context"; the ticket's memory maps to **`reactivity`** (docs describe "extra reactive context" diagnostics: `createMemo`/`createEffect` with no reactive reads, etc.).

### Solid 2 beta compatibility
- No open "Solid 2" support issue; rules are AST/type-based, so the *reactive* rules should work against Solid 2 beta's compiler output (linting reads source, not compiled output).
- Concrete mismatch: **`solid/imports`** only knows `solid-js`, `solid-js/web`, `solid-js/store` — all of which changed in Solid 2 (Solid 2.0 MIGRATION.md: `solid-js/web` → `@solidjs/web`, `solid-js/store` → `solid-js`). This repo's `src/index.tsx:1` imports `render` from `@solidjs/web` → expect a warning or a config tweak (the plugin hardcodes solid-js import tracking, issue #183 covers the custom-renderer case; a `@solidjs/web` pattern would need the same kind of fix).
- `jsxImportSource: "@solidjs/web"` (tsconfig.app.json:18) is the correct Solid 2 value and doesn't affect ESLint (ESLint parses JSX generically; typescript-eslint handles TSX).

---

## (c) Prettier + prettier-plugin-tailwindcss (Tailwind v4)

### Versions
- **Prettier 3.9.6** (2026-07-21) is current; 3.9.0 (2026-06-27) brought "major parser upgrades" incl. TS formatting improvements; 3.6.0 (2025-06-23) added the experimental fast CLI (`--experimental-cli`). Prettier's blog explicitly says to **pin the exact version** (`"prettier": "3.9.6"`, not `^`).
- **prettier-plugin-tailwindcss 0.8.1** (2026-07-15). **0.8.0** (2026-04-27): requires **Prettier ≥ 3.7**, is ESM-only, loads Tailwind v3/v4 modules on demand, added a public `/sorter` API. (GitHub release notes.)

### Tailwind v4 support — yes, with required config
- For v4 you **must set `tailwindStylesheet`** in Prettier config to the CSS entrypoint (the file with `@import "tailwindcss"` + your `@theme`). For this repo: **`./src/index.css`** (has `@import "tailwindcss";`, `@theme` tokens `surface-950/900/800/700`, `teal-spectre`, `--font-mono`, and `@utility tap`).
- Sorting is delegated to Tailwind itself (`env.context.getClassOrder` → Tailwind's `sort.ts`). **Tailwind v4 changed the sort order** vs v3 (tailwindlabs/prettier-plugin-tailwindcss#378, maintainer confirmation) — cosmetic, expected.
- **V4 correctness note:** in Tailwind v4, class order in your markup no longer affects the generated cascade (CSS-first, deterministic generation), so sorting is purely for **readability/diffs** — no correctness risk either way.
- Other options: `tailwindFunctions`, `tailwindAttributes`, `tailwindPreserveWhitespace`, `tailwindPreserveDuplicates`, `tailwindPackageName`. The plugin **must be last** in `plugins`.
- Solid: no special config; the plugin handles `class=` on Solid components (HTML-like attributes) out of the box.

### Prettier-vs-ESLint integration
Two supported shapes:
1. **Prettier as a separate formatter** (recommended by Prettier and the modern ESLint flat-config world): run `prettier --write` separately; add **`eslint-config-prettier`** to the ESLint config to turn off any conflicting style rules.
2. `eslint-plugin-prettier` (runs Prettier as an ESLint rule): discouraged now (runs the formatter inside the linter, slow, error-prone) — worth a one-line note for N5 to *reject*.

---

## (d) Biome as a single tool

### Versions / maturity
- **2.5.8** current (npm published 2026-08-04); 2.5.6/2.5.7 in Jul 2026; **2.5.0** (2026-06-12) + blog "Biome v2.5 — 500 Lint Rules, Plugin Code Fix, and Cross-File Linting" (2026-06-05): 500+ rules, **`--watch` mode** for `check`/`format`/`lint`, `lint`/`check` ~13% faster, formats `.svg`, import-organizer group matchers (`:NODE:`, `:PACKAGE:`, `:STYLE:`, `kind: "bare"`), JS APIs v6.
- **Biome 2.0** (stable 2025-06, blog 2025-06-17; upgrade guide biomejs.dev/guides/upgrade-to-biome-v2): removed `files.ignore`/`files.include` in favor of a single **`files.includes`** glob list with `!`-negated exceptions (the flat-ignore equivalent, and more powerful); `organizeImports` moved under **`assist.actions.source.organizeImports`**; new glob semantics (`*` vs `**/*`).
- Formatter covers **JS, TS, JSX, TSX, JSON, HTML, CSS, GraphQL** with **~97% Prettier compatibility** (algora.io challenge).
- Linter: **519+ rules** sourced from ESLint, typescript-eslint and others (biomejs.dev).

### SolidJS / TSX support
- Biome parses and formats TSX natively. It now ships **Solid-specific rules** (rule domain `solid`):
  - `lint/correctness/noSolidDestructuredProps` — **recommended**; "Disallow destructuring props inside JSX components in Solid" (biomejs.dev/linter/rules/no-solid-destructured-props/).
  - `lint/suspicious/noReactSpecificProps` — **recommended**, safe fix, sources *Same as solid/no-react-specific-props*; flags `className`/`htmlFor` (biomejs.dev/linter/rules/no-react-specific-props/).
  - `lint/performance/useSolidForComponent` — opt-in (since 2.0.0), inspired by `solid/prefer-for`; prefer `<For/>` over `.map()` (biomejs.dev/linter/rules/use-solid-for-component/).
  - In flight: `noSolidEarlyReturn` from `components-return-once` (biomejs/biome#8858, draft, Jan–Mar 2026); umbrella tracking issue biomejs/biome#2438 (Apr 2024).
- Community GritQL plugin **`biome-plugin-solidjs`** (npm 0.2.x, Mar–Apr 2026): `solid-no-destructured-props`, `solid-no-array-map-in-jsx`, `solid-no-memo-in-loop`, `solid-no-toplevel-effect`, `solid-no-stored-jsx` (structural, **no type info** — its own README says "For full type-aware linting, use these rules alongside `eslint-plugin-solid`").
- Gaps vs eslint-plugin-solid: no equivalent of the type-aware `reactivity` rule, `no-react-deps`, `event-handlers`, `imports`, `style-prop`, `jsx-no-undef`. For this repo's 527-line App.tsx the practical surface (destructured props, `.map()` in JSX, React-style props) is covered.

### Config / ignore / speed
- One config: `biome.json` (JSON or JSONC). `biome init`, `biome migrate eslint`, `biome migrate prettier` convert existing configs.
- Flat-ignore equivalent = `files.includes` with negation chains; `assist.includes` / `overrides[].includes` refine per-domain.
- CLI: `biome check` (format+lint+assist), `biome lint`, `biome format`, `biome ci` (no-write CI gate), `--write` / `--unsafe`. Editor: first-party VSCode extension via LSP.
- Speed: Rust + daemon; on a repo this size both tools are instant — speed is a *marginal* argument, not a deciding one.

### Concrete comparison (this repo)
| Dimension | ESLint 10 + typescript-eslint + eslint-plugin-solid + Prettier | Biome 2.5.x |
|---|---|---|
| Install size / moving parts | 4+ packages, 3 config files | 1 package, 1 config |
| Solid rules | 19 (16 recommended), incl. type-aware `reactivity` | 3 native + GritQL plugin (structural only) |
| Tailwind v4 class sorting | ✅ `prettier-plugin-tailwindcss` (needs `tailwindStylesheet`) | ❌ none |
| Import organization | via plugin (`eslint-plugin-simple-import-sort`) or Prettier(no) | ✅ native assist |
| Speed (this repo) | fast | faster; marginal |
| ESLint-10 lock-in | eslint-plugin-solid peer gap (see b) | n/a (self-contained) |
| Editor | VS Code ESLint ext | Biome ext |
| Readability of diagnostics | mature | good; `concise` reporter (2.5.0) |

---

## (e) Recommended stack, packages, scripts, config shapes

### Option A — ESLint + Prettier (matches the human's leaning; with the eslint-vite correction)

**devDependencies to add** (current versions, 2026-08-13):
```jsonc
{
  "devDependencies": {
    "eslint": "^10.8.1",               // or pin 9.39.5 if you refuse the peer hack (v9 EOL 2026-08-06)
    "@eslint/js": "^10.0.0",           // ships js.configs.recommended
    "typescript-eslint": "^8.67.0",    // meta-package (parser+plugin+utils); TS 6 supported since 8.58.0
    "eslint-plugin-solid": "~0.14.5",  // pre-1.0: pin minor (plugin's own advice)
    "globals": "^16.0.0",
    "eslint-config-prettier": "^10.0.0", // turns off style rules that conflict with Prettier
    "prettier": "3.9.6",               // EXACT pin (prettier.io blog)
    "prettier-plugin-tailwindcss": "^0.8.1"
  }
}
```
Install caveat (npm): `eslint-plugin-solid` declares peer `eslint ^6–^9`, so `eslint@10` triggers ERESOLVE. Either `.npmrc` with `legacy-peer-deps=true`, or pnpm `peerDependencyRules.allowedVersions: { eslint: "^10" }` — and track solidjs-community/eslint-plugin-solid#203 / PR #207. Alternative: pin `eslint@9.39.5` (EOL) and upgrade when the plugin releases.

**eslint.config.js** (flat, type-aware for src; JSX handled by typescript-eslint):
```js
// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import solid from 'eslint-plugin-solid/configs/typescript'
import globals from 'globals'
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default tseslint.config(
  { ignores: ['dist', 'public', 'node_modules', '.wrangler', '.wayfinder', 'wrangler.toml', '*.html'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [solid],
    languageOptions: {
      parserOptions: { project: './tsconfig.app.json', tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
  },
  // vite.config.ts / tsconfig.node.json (node globals) — separate small block, or drop type-aware linting here
  eslintConfigPrettier,
)
```
(ESLint 10 loads `eslint.config.js` natively; `.ts` configs work with `--flag unstable_native_nodejs_ts_config` on Node ≥ 22.13, not needed here.)

**.prettierrc.json**:
```json
{
  "semi": false,
  "singleQuote": true,
  "trailingComma": "all",
  "plugins": ["prettier-plugin-tailwindcss"],
  "tailwindStylesheet": "./src/index.css"
}
```
(Matches the repo's current style — no semicolons, single quotes. N5 can instead defer to Prettier defaults: `semi: true`, `singleQuote: false`; "trailingComma: all" is already the 3.x default.)

**npm scripts**:
```jsonc
{
  "scripts": {
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "format": "prettier --check .",
    "format:fix": "prettier --write ."
  }
}
```
Gating: keep `lint`/`format` separate from `build`/`test` for now; CI gate (if any) uses `lint` + `format` (no-write). Optionally `@nabla/vite-plugin-eslint` only if a dev-server overlay is wanted later — not recommended for this repo.

### Option B — Biome (single tool)

**devDependencies:** `@biomejs/biome` (exact, `--save-exact` per biomejs.dev).

**biome.json** (v2 shape):
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
  "files": { "includes": ["**", "!dist", "!public", "!.wrangler", "!.wayfinder", "!*.html"] },
  "formatter": { "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": {
    "rules": {
      "recommended": true,
      "correctness": { "noSolidDestructuredProps": "error" },
      "performance": { "useSolidForComponent": "error" }
    }
  },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "plugins": ["biome-plugin-solidjs"]
}
```
(GritQL plugin shape per biomejs.dev/linter/plugins; if the plugin is deemed too fresh, the 3 native Solid rules still cover the repo's main hazards.)

**npm scripts:**
```jsonc
{
  "scripts": {
    "lint": "biome check .",
    "lint:fix": "biome check --write .",
    "format": "biome format .",
    "format:fix": "biome format --write ."
  }
}
```
(`biome ci .` = the no-write CI gate.) No Tailwind class sorting — accepted as a gap, or keep prettier-plugin-tailwindcss as a one-off `prettier --write` for class ordering only (mixed-tooling, usually not worth it).

---

## Migration notes for the 527-line `src/App.tsx` (N10 input)

- **Formatting will produce a large diff.** `App.tsx` has ~50 `class="..."` Tailwind strings (e.g. `rounded border border-surface-700 bg-surface-800 tap px-2 py-1 text-sm text-slate-100`) — prettier-plugin-tailwindcss will reorder every one (with `tailwindStylesheet` set it also resolves `surface-*`/`teal-spectre` from `@theme` and the `tap` utility). Land `format:fix` as its own commit, and agree the order rule with N5 before applying.
- **Lint should come out near-clean** — checked the file: uses `class` (not `className`), `<For/>`/`<Show/>` (not `.map()` in JSX), no props destructuring (`SiteFields(props)` at line 38 accesses `props.draft`), no `innerHTML`, no inline `style` prop. Watch-outs:
  - `solid/imports` on `src/index.tsx:1` (`@solidjs/web`) — Solid-2 package it doesn't know (see b).
  - `solid/event-handlers` may complain about inline/arrow handlers (`onClick={() => {...}}` at line 384 and similar) — configure or accept warnings.
  - `reactivity` may flag memos/effects with no reactive reads (e.g. `createMemo` over `status()`), and nested component definitions like `IdentityView()` (line 416) may trigger a warn — triage each before deciding on disable-comments.
- **`eslint .` must not scan** `dist/`, `.wrangler/`, `.wayfinder/`, `wrangler.toml`, `spike.html` — the flat `ignores` above handles it; also add `eslint.config.js` ignore-if-self and `.eslintcache` to `.gitignore`.
- Type-aware linting needs `parserOptions.project`; the repo splits tsconfigs (`tsconfig.app.json` for `src`, `tsconfig.node.json` for config files) — the sample config points at the app tsconfig only; a tiny node block (or `projectService`) is needed to lint `vite.config.ts` without false "not in project" errors.

## Known incompatibilities to surface at N5

1. **eslint-plugin-solid 0.14.5 vs ESLint 10** — peer `^6–^9` only; ERESOLVE on install; real ESLint-10 runtime needs `@typescript-eslint/utils ≥ 8.56.0`; fix is approved-but-unmerged PR #207 (as of 2026-08-13). ESLint 9 is EOL.
2. **eslint-plugin-solid's `imports` rule vs Solid 2's `@solidjs/web`** — package map is 1.x-era.
3. **prettier-plugin-tailwindcss** — needs `tailwindStylesheet: "./src/index.css"`; ESM-only; Prettier ≥ 3.7; must be last in `plugins`.
4. **Biome** — no Tailwind class sorting; Solid rules structural-only (no type-aware `reactivity`); GritQL plugin is community/young.
5. **No official `eslint-vite`** — correct the map's wording; if a dev overlay is truly wanted use `@nabla/vite-plugin-eslint` (vite ^4–^8, eslint ^9||^10).

## Open questions for N5 / next tickets

- Accept the eslint-plugin-solid peer hack (ESLint 10 + `legacy-peer-deps`) or pin EOL ESLint 9, or wait for the plugin release? (Track #203/#207.)
- Prettier style: repo-matching (no-semi, single quotes) vs defaults (semi, double quotes)?
- Do `lint`/`format` gate `build`/`test`, or stay separate? (Map currently: separate.)
- Is Tailwind class sorting worth the second formatter (vs Biome-only, which sorts nothing)?
- Formatting a 527-line `App.tsx` in one commit, or split `format:fix` from lint fixes (recommended)?

## Sources
- npm registry / npmjs.com pages: `eslint-vite` (0.0.1-security), `eslint-plugin-solid` (0.14.5, peerDeps), `typescript-eslint`, `@nabla/vite-plugin-eslint` (3.0.1), `vite-plugin-eslint2` (5.3.0), `prettier` (3.9.6), `prettier-plugin-tailwindcss` (0.8.1), `@biomejs/biome` (2.5.8), `biome-plugin-solidjs` (0.2.x) — all fetched 2026-08-13.
- GitHub: solidjs-community/eslint-plugin-solid#203, #207 (approved 2026-07-30, unmerged), #178, #183; solidjs/solid `documentation/solid-2.0/MIGRATION.md`; tailwindlabs/prettier-plugin-tailwindcss releases v0.8.0 (2026-04-27) / v0.8.1 (2026-07-15), issue #378; eslint org repository search (0 vite repos); biomejs/biome#8858, #2438; typescript-eslint releases (TS 6 support in v8.58.0, 2026-03-30; v8.67.0 2026-08-10).
- Blogs/docs: eslint.org/blog (v10.0.0 2026-02-06; v9 EOL banner 2026-08-06; release 10.8.1 2026-08-07), eslint.org/docs (flat config, feature flags, integrations), prettier.io/blog 3.6.0 (2025-06-23) & 3.9.0 (2026-06-27), tailwindcss.com/blog/automatic-class-sorting-with-prettier, biomejs.dev (v2.5 blog 2026-06-05, upgrade-to-biome-v2, configuration, CLI, linter rules noSolidDestructuredProps / noReactSpecificProps / useSolidForComponent, linter/plugins), vite.dev/blog/announcing-vite8 (2026-03-12), typescript-eslint.io/users/dependency-versions.
