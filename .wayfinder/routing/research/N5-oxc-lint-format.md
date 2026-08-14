# N5 — Replace ESLint + Prettier with the Oxc toolchain (oxlint + oxfmt)

> Research ticket N5 · wayfinder routing map · researched 2026-08-13 (AFK web research)
> Complements N3 (`N3-lint-format-stack.md`), which covered the ESLint+Prettier and Biome alternatives. This ticket is the Oxc path the human has since chosen: **oxlint** for linting, **oxfmt** for formatting, ESLint plugins via oxlint's JS-plugin compat if needed.
> All versions/dates verified against npm registry, GitHub (oxc-project/oxc), and oxc.rs on 2026-08-13.

## TL;DR

- **oxlint 1.78.0** (2026-08-10) and **oxfmt 0.63.0** (2026-08-10) are both current. Install as plain devDeps: `npm i -D oxlint oxfmt`. Both run with **zero config** out of the box; oxlint enables the `correctness` category with the `eslint`, `typescript`, `unicorn`, `oxc` plugins by default.
- **There are no native Solid rules in oxlint.** The compatibility matrix says exactly: *"Solid: Solid-specific rules available via JS plugins"* (oxc.rs/compatibility). Native plugin names are reserved (`react`, `typescript`, `unicorn`, …) and `solid` is not among them. Solid reactivity linting is **only** achievable through the **JS-plugin (alpha) layer** — either load `eslint-plugin-solid` directly via the `jsPlugins` config key (confirmed working, oxc discussion #19936), or use the dedicated port **`oxlint-plugin-solidjs` 0.1.1** (2026-02-21). Correcting the ticket: **`solid/no-extra-reactive-context` does not exist** in eslint-plugin-solid 0.14.5 (that's the Svelte plugin's `no-extra-reactive-curlies`); the ticket's memory maps to the flagship type-aware `solid/reactivity` rule.
- **oxfmt is beta (0.x, not 1.0)** but is 100% Prettier-conformance-tested, is used by vuejs/core, vercel/turborepo, sentry-javascript, huggingface, and — critically — **replaces `prettier-plugin-tailwindcss` natively** via its built-in `sortTailwindcss` option (same algorithm, off by default, v4 via `stylesheet`). It has `--check` for CI. Prettier *plugins* are not supported (on the roadmap), and it does **not** read `.prettierrc` — you migrate config once with `oxfmt --migrate prettier`.
- **Vite integration:** `vite-plugin-oxlint` **2.1.2** (2026-06-11) supports Vite 8 (peer `vite >=5.0.0`, dev-tested against vite ^8). There is **no maintained vite plugin for oxfmt**. Recommendation for this repo: **standalone CLI scripts** (`oxlint`, `oxfmt --check`), matching N3's "linting as its own process" stance; the vite plugin is optional sugar for a dev overlay. "vite plus has oxlint and oxfmt" = **Vite+** (`vite-plus` 0.2.9, VoidZero beta), a whole-toolchain product that manages Node/package-manager and pins its own older oxc versions (oxlint 1.77.0 / oxfmt 0.62.0) — **not recommended** here.
- **Recommended setup (bottom of file):** add `oxlint`, `oxfmt`, and one Solid plugin (`eslint-plugin-solid` via `jsPlugins`, or `oxlint-plugin-solidjs` to avoid pulling ESLint in as a peer); delete `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, and the `@nabla/vite-plugin-eslint` wiring; add `.oxlintrc.json` + `.oxfmtrc.json`; scripts `lint`/`lint:fix`/`format`/`format:fix` map 1:1 onto the current ESLint/Prettier scripts.

---

## (a) oxlint — version, install, config, defaults

### Version + release cadence
- **1.78.0**, npm published 2026-08-10 (GitHub release tag `apps_v1.78.0`, 2026-08-10T10:46Z; npm page "Updated: 2026-08-10"). Weekly downloads ≈ **14.8M**. Releases are weekly (1.77.0 2026-08-03, 1.76.0 2026-07-27, …; CHANGELOG confirms).
- **1.0.0 stable** shipped 2025-06-10 (oxc.rs blog "Oxlint v1.0 Stable"); it's past the stable milestone, so semver applies (this matters because JS plugins are *not* semver-stable — see (b)).

### Install
```sh
npm i -D oxlint
```
(npm docs quickstart; also `npx oxlint@latest` runs it without install.)

### CLI + config file format
- Usage: `oxlint [OPTIONS] [PATH]...` — lints cwd when no path given.
- Auto-discovery in cwd: **`.oxlintrc.json`**, **`.oxlintrc.jsonc`**, **`oxlint.config.ts`**, **`oxlint.config.mts`** (in that order of tooling). Explicit: `-c` / `--config <file>`. `oxlint --init` writes a starter `.oxlintrc.json`. JSON configs accept comments (JSONC). Config format is "aimed at being compatible with ESLint v8's format".
- The `.oxlintrc.json` config format does **not** support package imports / JS expressions — for those use `oxlint.config.ts` with `import { defineConfig } from "oxlint"` (needs the Node-based package and Node 22.18+/24+; this repo is on Node 24 → fine).
- **A config file is optional** — oxlint works with sensible defaults with zero config. "No configurations are required" (npm README). The docs recommend committing one anyway for consistency.

### Default rule categories + plugins (important for drop-in)
- **Categories enabled by default: `correctness` only.** Available: `correctness`, `suspicious`, `pedantic`, `perf`, `style`, `restriction`, `nursery`, `all`. Configured via `categories` key or CLI `-A/-W/-D` (allow/warn/deny; also `-D correctness -D suspicious`).
- **Plugins enabled by default: `eslint`, `typescript`, `unicorn`, `oxc`.** `react`, `react-perf`, `nextjs`, `import`, `jsdoc`, `jsx-a11y`, `node`, `promise`, `jest`, `vitest`, `vue` are built-in but **off by default** (enable via `plugins` config key, or CLI flags `--import-plugin`, `--vitest-plugin`, `--jsx-a11y-plugin`, etc.). Setting `plugins` **overwrites** the default set, so list all of them.
- Severities: `"off"`/`"allow"`, `"warn"`, `"error"`/`"deny"`; rule options via `[severity, options]` arrays. Unprefixed ESLint-core names work (`"no-console"` ≡ `"eslint/no-console"`).
- Other relevant CLI: `--fix`, `--fix-suggestions`, `--fix-dangerously`; `--quiet`, `--deny-warnings`, `--max-warnings 0` (CI gates); `-f json|github|gitlab|junit|checkstyle|stylish|unix|sarif`; `--ignore-path` / `--ignore-pattern` / `--no-ignore`; respects `.gitignore` by default; `--print-config <file>`; `--type-aware` (type-aware linting, stable 2026-07-22) and `--type-check` (experimental, tsgo).
- **Do NOT try to put config in `vite.config.ts`.** oxlint (and oxfmt) only read `vite.config.ts` `.lint`/`.fmt` blocks when the `VP_VERSION` env var is set (i.e. under Vite+); that support was gated behind the env var in oxlint ≥ 1.60 / oxfmt ≥ 0.45 (PRs #21298/#21295), and oxc issue #22539 says native `vite.config.ts` support is *not* coming. In a plain-Vite repo the config must live in `.oxlintrc.json` / `oxlint.config.ts`.

---

## (b) SolidJS support in oxlint

### Native: none
- The built-in plugin table (oxc.rs/docs/guide/usage/linter/plugins.html) lists `eslint, typescript, unicorn, react, react-perf, nextjs, oxc, import, jsdoc, jsx-a11y, node, promise, jest, vitest, vue` — **no `solid`**.
- The compatibility matrix row for Solid is: **"Solid: Solid-specific rules available via JS plugins"** (oxc.rs/compatibility.html).
- A feature request for native Solid support is open (oxc discussion #19936, 2026-03-25; also issue #13894) and the maintainer's answer is: *"the JS plugin should work, and that is the suggested way to use the solid plugin."* So native Solid rules are **not on the near-term map** — the JS-plugin layer is the intended path.

### Loading eslint-plugin-solid directly — yes, works
- Oxlint has a JS-plugin system compatible with the **ESLint v9+ plugin API** (most of it implemented: traversal, fixes, selectors, sourceCode, scope, code paths, inline disables, LSP). It's in **alpha** ("not subject to semver").
- Loading is via the **`jsPlugins` key in a config file** (`.oxlintrc.json` or `oxlint.config.ts`), NOT a CLI flag. There is no generic `--plugin` flag; the only plugin CLI flags are for built-in native plugins (`--import-plugin`, `--js-plugins=false` to turn JS plugins off, `--disable-unicorn-plugin`, …). So a config file is **required** to use Solid rules.
- `jsPlugins` values are import specifiers resolved from the config file: `"eslint-plugin-solid"` works directly (also `./plugin.js`, `@scope/eslint-plugin`). Add rules under `rules` with the plugin's own names (`solid/reactivity`, etc.).
- **Confirmed working for eslint-plugin-solid** — oxc discussion #19936 (maintainer-approved) shows the exact `.oxlintrc.json`, and a community trick for keeping in sync: an `oxlint.config.ts` that spreads the plugin's recommended rules:
  ```ts
  import { defineConfig } from "oxlint";
  import solid from "eslint-plugin-solid/configs/typescript";
  export default defineConfig({
    jsPlugins: ["eslint-plugin-solid"],
    rules: { ...solid.rules },
  });
  ```
- Caveats of the JS-plugin layer (from the js-plugins doc):
  - **Not supported: "Lint rules that rely on TypeScript type-awareness."** `solid/reactivity` is the type-aware flagship rule of eslint-plugin-solid — expect it to be degraded/unavailable under oxlint's JS plugin runtime (no `parserOptions.project` equivalent feeds the plugin's type info). The structural rules (`solid/no-destructure`, `solid/prefer-for`, `solid/jsx-no-duplicate-props`, `solid/jsx-no-undef`, `solid/no-innerhtml`, …) are unaffected.
  - Not in oxlint's official conformance-test list (which covers playwright, react-hooks, testing-library, etc.) — it's community-verified, not CI-verified.
  - eslint-plugin-solid (0.14.5) declares **peer `eslint ^6–^9`** and npm ≥ 7 **auto-installs peer deps** — so keeping it means `eslint@9` lands in `node_modules` anyway (inert, but present). Use `oxlint-plugin-solidjs` to avoid that (no eslint peer).

### Alternative: `oxlint-plugin-solidjs` (0.1.1, 2026-02-21)
- npm: "SolidJS lint rules ported from eslint-plugin-solid to Oxlint's JS plugin API. Also compatible with ESLint flat config." Requires **oxlint ≥ 1.0.0**, Node ≥ 18. Supports **SolidJS v1.x**. MIT, from takinprofit/biome-plugins.
- Config:
  ```jsonc
  {
    "jsPlugins": ["./node_modules/oxlint-plugin-solidjs/dist/index.js"],
    "rules": {
      "oxlint-plugin-solidjs/reactivity": "warn",
      "oxlint-plugin-solidjs/no-destructure": "error",
      "oxlint-plugin-solidjs/jsx-no-duplicate-props": "error",
      "oxlint-plugin-solidjs/prefer-for": "error"
    }
  }
  ```
- Caveats: third-party/small project; README flags `jsx-uses-vars` as not-yet-supported; v1.x-targeted like the original.

### Rule-name correction for the ticket
`solid/no-extra-reactive-context` **does not exist** in eslint-plugin-solid 0.14.5 (verified: rule table in the plugin README + docs directory; the name resembles Svelte's `svelte/no-extra-reactive-curlies`). The "extra reactive context" concept the ticket means is the `solid/reactivity` rule (its docs cover "reactive context" diagnostics, e.g. effects/memos with no reactive reads). Destructuring is `solid/no-destructure`. Solid-2-relevant rules in eslint-plugin-solid: `reactivity`, `no-destructure`, `prefer-for`, `prefer-show`, `components-return-once`, `event-handlers`, `no-react-deps`, `no-react-specific-props`, `jsx-no-duplicate-props`, `jsx-no-undef`, `jsx-uses-vars`, `no-innerhtml`, `style-prop`, `imports`, `self-closing-comp`, `no-unknown-namespaces`, `no-array-handlers`, `no-proxy-apis`, `prefer-classlist`.

### Solid 2 (beta) reality check
This repo is on **solid-js 2.0.0-beta.32 + @solidjs/web**. Both Solid lint plugins target v1 semantics; per N3, the concrete known mismatch is `solid/imports` (stale package map: `solid-js/web` → `@solidjs/web`), and this repo's `src/index.tsx:1` imports from `@solidjs/web`. The AST-based rules (`no-destructure`, `prefer-for`, JSX hygiene) fire on v1-style code regardless of runtime version; truly Solid-2-specific reactivity patterns have **no** tool coverage today (neither oxlint, nor eslint-plugin-solid, nor Biome).

### Closest native oxlint rules (if you skip Solid plugins)
There is no native reactivity coverage. Best-effort native hygiene that helps a Solid codebase:
- `eslint/no-unused-vars` (default correctness) — unused vars, JSX-aware in oxlint.
- `typescript/*` default correctness rules (`no-explicit-any` style ones are off-by-default; turn on `typescript/no-explicit-any`, `typescript/consistent-type-imports`, etc. as wanted).
- `unicorn/*` correctness rules for general quality.
- JSX duplicate props is only in the native `react` plugin (off by default; the `react` name is reserved, so a JS react plugin would need an alias — not worth it). Net: **native rules do not substitute for Solid reactivity linting**; if reactivity matters, you must use a JS plugin.

---

## (c) oxfmt — status, install, Prettier compat, Tailwind, `--check`

### Status: beta, but production-used and Prettier-conformance-tested
- **0.63.0** (npm, 2026-08-10; ~10.3M weekly downloads). Release cadence: 0.62.0 (2026-08-03), 0.61.0 (2026-07-27), … (CHANGELOG).
- **Beta announced 2026-02-24** (oxc.rs blog "Oxfmt Beta"): "Prettier-compatible", 30× faster than Prettier / 3× faster than Biome (bench-formatter), **passes 100% of Prettier's JS/TS conformance tests**. **Not yet 1.0.** Roadmap: Prettier plugin support, more xxx-in-js polish, stability, perf. Adopters cited in the blog: vuejs/core, vercel/turborepo, huggingface.js, getsentry/sentry-javascript, openclaw, npmx.dev.
- **Honest production-readiness call:** for a tiny repo it's safe to use for formatting + `--check` CI gating today, *provided you pin the exact version* — it is 0.x and released weekly, and recent minors have shipped "breaking AST and formatter changes" (e.g. v0.62.0). The risk is a format churn on the next bump, not broken output. If the team wants zero 0.x tools, Prettier stays (that's the N3 fallback); but the human has already chosen Oxc, and oxfmt is the far more mature half of the pair.

### Install + scripts
```sh
npm i -D oxfmt
# scripts: "format": "oxfmt", "format:check": "oxfmt --check"
```
Default mode is `--write`; `--check` verifies without writing (CI), `--list-different` lists changed files. `--no-error-on-unmatched-pattern` for lint-staged.

### Prettier compatibility
- **Does NOT read `.prettierrc`** (nor the `prettier` field in package.json — explicitly unsupported). Own config files: **`.oxfmtrc.json`**, **`.oxfmtrc.jsonc`**, **`oxfmt.config.ts`**, **`oxfmt.config.mts`**. Migration helper: **`oxfmt --migrate prettier`** converts your Prettier config and reformats in one go (also `--migrate biome`, `--init`).
- Compatible with **Prettier v3.8** for many configurations; key differences (from migrate-from-prettier doc):
  - **Default `printWidth` is 100 (Prettier: 80)** — the current repo relies on Prettier's 80, so an `.oxfmtrc.json` **must set `"printWidth": 80`** to avoid a reformat of the 527-line App.tsx.
  - Defaults otherwise: `semi: true`, `singleQuote: false`, `trailingComma: "all"`, `tabWidth: 2`, `useTabs: false`, `arrowParens: "always"`, `bracketSpacing: true`. `endOfLine` is `lf` (`"auto"` unsupported). `.editorconfig` is respected for some options.
  - **Prettier plugins are NOT supported** — but first-party built-in equivalents exist: `sortImports` (perfectionist algorithm, off), `sortTailwindcss` (prettier-plugin-tailwindcss algorithm, off), `sortPackageJson` (on by default), `jsdoc` (off).
  - `// prettier-ignore` comments are honored; `// oxfmt-ignore` also supported (JS/TS only).
  - Ignore handling: by default oxfmt reads **`.gitignore` and `.prettierignore`** from cwd (`--ignore-path` to override); config option `ignorePatterns` (gitignore-style, rooted at config dir). `node_modules` skipped by default (`--with-node-modules` to include).
  - Since oxlint v1.77/oxfmt v0.62, both respect `.gitignore` for walk targets.

### Tailwind (v4) class sorting — natively covered, no plugin needed
- `sortTailwindcss` option, disabled by default. Same algorithm as prettier-plugin-tailwindcss. Applies to JS/JSX/TS/TSX/HTML/Vue/Angular/Handlebars/CSS/SCSS/Less/Svelte.
- v4-specific: **`sortTailwindcss.stylesheet`** = path to the Tailwind CSS entrypoint (defaults to installed Tailwind's `theme.css`). For this repo: `"./src/index.css"` — a direct replacement for prettier-plugin-tailwindcss's `tailwindStylesheet`.
- Other options: `attributes`, `functions` (e.g. `["clsx","cn"]`), `config` (v3 config), `preserveDuplicates`, `preserveWhitespace`. Regex patterns not yet supported.
- Per N3, Tailwind v4 class order is **purely cosmetic** (no cascade impact), so even skipping sorting is zero-risk. But since oxfmt supports it natively, there is no reason to skip.

---

## (d) Vite integration

### `vite-plugin-oxlint` — exists, Vite 8 OK
- **2.1.2**, published 2026-06-11, MIT, by **52-entertainment / arnaud (Arnaud Riu)**, ~101k weekly downloads, 4 dependents. `peerDependencies`: **`vite >=5.0.0`**, `oxlint >=0.9.0` → **Vite 8 supported** (the plugin's own devDeps use `vite ^8.0.16`).
- What it does: spawns the oxlint binary. Runs at **build start** (`lintOnStart`, default true) and on **every HMR update** during dev (`lintOnHotUpdate`, default true). Logs diagnostics; `failOnError`/`failOnWarning` (default false) to fail the build; `quiet`; `fix`; `format` (stylish/unix/json/github/gitlab/junit/checkstyle); `ignorePattern`; `allow/deny/warn`; `oxlintPath` (monorepos); `params` (raw CLI flags).
- Quirk: its default `configFile` is **`oxlintrc.json` (no leading dot)** — set `configFile: '.oxlintrc.json'` explicitly. No serve-mode error overlay of its own; diagnostics are logged.
- **No official/maintained Vite plugin for oxfmt exists.** Search of npm + Vite ecosystem turned up only `vite-plugin-oxc` — **deprecated** (transform/resolve/minify tool, unmaintained; its README points to `@vitejs/plugin-react`). Formatting at dev time is not a real workflow; oxfmt is a CLI + LSP.

### Recommendation: standalone CLI scripts
For this repo the cleanest shape is **oxlint/oxfmt in npm scripts** (same stance N3 took for ESLint), and *optionally* `vite-plugin-oxlint` for a dev-overlay later. The current `@nabla/vite-plugin-eslint` wiring is removed either way. Standalone also makes CI gating trivial (`npm run lint` + `npm run format`).

### "vite plus has oxlint and oxfmt" = Vite+ (vite-plus)
- **`vite-plus` 0.2.9** (VoidZero Inc., beta; homepage viteplus.dev, repo voidzero-dev/vite-plus) is *the unified toolchain* the oxc docs refer to ("Choose Vite+ instead if you want Oxfmt as part of a larger unified toolchain"). It ships `vp`/`vpr`/`oxlint`/`oxfmt` bins, **pins its own oxlint =1.77.0 and oxfmt =0.62.0**, adds tsgolint (TS7 type-checking), and puts lint/format config in `lint:`/`fmt:` blocks of `vite.config.ts`.
- Adoption cost for this repo is high and undesirable: it wants a global `vp` CLI, manages the Node runtime + package manager, replaces the dev server/test runner story, and pins slightly older oxc versions than standalone latest. **Not recommended** — the standalone `oxlint` + `oxfmt` packages give the same tools at current versions with the repo's existing Vite/vite-plugin-solid/@tailwindcss/vite setup untouched.

---

## (e) Tailwind v4 class sorting in the Oxc toolchain

- **oxfmt has it built-in**: `sortTailwindcss` (see (c)) — same algorithm as `prettier-plugin-tailwindcss`, v4 via `stylesheet: "./src/index.css"`. This is the replacement; `prettier-plugin-tailwindcss` + `prettier` can be uninstalled.
- **oxlint has no class-sorting rule** (sorting is a formatter concern; oxlint's `style` category does not touch Tailwind class order).
- No standalone alternative needed — oxfmt covers it. If you ever skip it, it's cosmetic-only in v4 (N3 confirmed).

---

## (f) Exact recommended setup for this repo

### devDependencies
```jsonc
// ADD
"oxlint": "^1.78.0",               // exact-pin instead if you fear weekly 0.x churn? oxlint is 1.x stable — ^ fine
"oxfmt": "0.63.0",                 // 0.x: EXACT PIN (weekly beta releases, breaking minors)
// ONE of:
"eslint-plugin-solid": "~0.14.5",  // via jsPlugins; npm auto-installs eslint@9 as its peer (inert)
// or: "oxlint-plugin-solidjs": "^0.1.1"   // no eslint peer; third-party port

// REMOVE (replaced)
"eslint", "@eslint/js", "@typescript-eslint/eslint-plugin",
"@typescript-eslint/parser", "globals",
"prettier", "prettier-plugin-tailwindcss", "@nabla/vite-plugin-eslint"
```

### Files to delete
`eslint.config.js`, `.prettierrc.json`, `.prettierignore` (move its contents into `.oxfmtrc.json` `ignorePatterns` below, or leave `.prettierignore` since oxfmt reads it by default — deleting and consolidating is cleaner).

### vite.config.ts — remove the ESLint wiring
Delete the `import eslint from '@nabla/vite-plugin-eslint'` line and the `eslint()` entry in `plugins: [...]`. Everything else (`solid()`, `tailwindcss()`, `VitePWA(...)`) stays.

### `.oxlintrc.json`
```jsonc
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["eslint", "typescript", "unicorn", "oxc", "import", "vitest"],
  "categories": {
    "correctness": "warn",
    "suspicious": "warn"
  },
  "jsPlugins": ["eslint-plugin-solid"],
  "rules": {
    "solid/no-destructure": "error",
    "solid/prefer-for": "error",
    "solid/jsx-no-duplicate-props": "error",
    "solid/jsx-no-undef": ["error", { "typescriptEnabled": true }],
    "solid/jsx-uses-vars": "error",
    "solid/no-innerhtml": "error",
    "solid/components-return-once": "warn",
    "solid/event-handlers": "warn",
    "solid/reactivity": "warn",
    "solid/no-unknown-namespaces": "off"
  },
  "ignorePatterns": [
    "dist/**", "node_modules/**", "public/**", ".playwright-mcp/**",
    ".wayfinder/**", ".wrangler/**", "crates/**", "src/lib/spike/**",
    "index.html", "spike.html", "wrangler.toml"
  ],
  "overrides": [
    { "files": ["**/test/**", "**/tests/**"], "env": { "vitest": true } }
  ]
}
```
Notes:
- `plugins` overwrites the default set — the list above keeps the four defaults and adds `import` + `vitest` (both useful here; enable only what you want).
- Prefer `oxlint.config.ts` if you want to keep eslint-plugin-solid's ruleset in sync automatically (`{ jsPlugins: ["eslint-plugin-solid"], rules: { ...solid.rules } }` per #19936) or use the alias-trick for the `oxlint-plugin-solidjs` path. `.oxlintrc.json` cannot import packages.
- If you choose `oxlint-plugin-solidjs` instead, swap `jsPlugins` to the dist path and rules to `oxlint-plugin-solidjs/...` (see (b)).
- Optional later: `"options": { "typeAware": true }` for oxlint's own type-aware typescript rules (stable since 2026-07-22); `--type-check` is experimental (tsgo). This does **not** give eslint-plugin-solid type info (jsPlugins rules can't use type-awareness).
- Migration aid if you ever want to re-run the whole ESLint→oxlint conversion: `@oxlint/migrate` / `npx skills add https://github.com/oxc-project/oxc --skill migrate-oxlint` + `/migrate-oxlint`.

### `.oxfmtrc.json`
```jsonc
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "printWidth": 80,            // Prettier default was 80; oxfmt default is 100 — keep 80 to avoid reformat
  "semi": false,               // matches current repo style
  "singleQuote": true,         // matches current repo style
  "trailingComma": "all",      // Prettier 3.x default; oxfmt default too
  "sortTailwindcss": {
    "stylesheet": "./src/index.css"   // v4: replaces prettier-plugin-tailwindcss tailwindStylesheet
  },
  "ignorePatterns": [
    "dist/**", "node_modules/**", "public/**", ".playwright-mcp/**",
    ".wayfinder/**", ".wrangler/**", "crates/**", "src/lib/spike/**",
    "index.html", "spike.html", "wrangler.toml", "package-lock.json", "CONTEXT.md"
  ]
}
```
Notes:
- `sortImports` is off by default — leave it off (the repo has no import-sorting convention) unless N5 wants perfectionist-style sorting (then `"sortImports": true` or an object with groups).
- `sortPackageJson` is **on by default** and will reorder package.json keys on first `oxfmt` run — expected, commit separately.
- oxfmt would also accept `--migrate prettier` to generate this file from the current `.prettierrc.json`, then you only add `printWidth`/`sortTailwindcss`/`ignorePatterns`.

### npm scripts (drop-in for current ones)
```jsonc
{
  "lint": "oxlint",
  "lint:fix": "oxlint --fix",
  "format": "oxfmt --check",
  "format:fix": "oxfmt"
}
```
(Current scripts were `eslint .`, `eslint . --fix`, `prettier --check .`, `prettier --write .`. Same names, same semantics. Optionally `"format:list": "oxfmt --list-different"` for pre-commit, and `--deny-warnings` on lint in CI if you want warnings to fail.)

### Landing order (for N10)
1. `npm i -D oxlint oxfmt <solid plugin>`; `npm rm` the seven removed packages.
2. Write `.oxlintrc.json` + `.oxfmtrc.json`; delete `eslint.config.js`, `.prettierrc.json`, `.prettierignore`.
3. Edit `vite.config.ts` (remove eslint plugin).
4. `npm run format:fix` as its own commit (App.tsx reformat diff; expect Tailwind class re-sort + `printWidth 80` behavior).
5. `npm run lint:fix`, then triage remaining warnings.

---

## Incompatibilities / caveats to surface

1. **No native Solid rules** — Solid linting must go through the **alpha** JS-plugin layer (`jsPlugins`), which is not semver-stable and has no CI-conformance coverage for eslint-plugin-solid.
2. **`solid/reactivity` is type-aware** in eslint-plugin-solid; oxlint's JS-plugin API does **not** support type-aware rules → expected degraded reactivity coverage. Structural rules are unaffected.
3. **eslint-plugin-solid pulls `eslint@9` in as an auto-installed peer** (npm ≥ 7). Zero-ESLint-package purity requires `oxlint-plugin-solidjs` instead (v0.1.1, third-party, v1-targeted).
4. **Solid 2 beta** — no tool understands Solid 2's new package map; `solid/imports` is stale (`@solidjs/web`, per N3). Both Solid plugins target v1 semantics.
5. **oxfmt is 0.x beta** — pin exact (`0.63.0`); weekly releases have carried breaking formatter changes. `--check` in CI is the safe usage. Prettier plugins unsupported (not needed here).
6. **oxfmt default `printWidth` is 100 vs Prettier's 80** — must set `printWidth: 80` in `.oxfmtrc.json` or the whole repo gets reformatted.
7. **`vite.config.ts` `.lint`/`.fmt` blocks do not work** outside Vite+ (gated behind `VP_VERSION`; oxc #22539). Config lives in `.oxlintrc.json` / `.oxfmtrc.json`.
8. **`vite-plugin-oxlint` default `configFile` is `oxlintrc.json` (no dot)** — pass `configFile: '.oxlintrc.json'` if you use it.

## Open questions for N10
- Solid rules via `eslint-plugin-solid` (faithful, alpha jsPlugins, pulls eslint peer) vs `oxlint-plugin-solidjs` (clean deps, third-party, v1-only) vs native-only (no reactivity coverage)?
- Accept oxfmt 0.x (exact-pin, `--check` in CI) or stay on Prettier until oxfmt 1.0?
- Enable oxlint `--type-aware` for the typescript plugin, given `solid/reactivity` type info is unavailable anyway?
- `sortImports` on or off; `sortPackageJson` reorder in the format commit?

## Sources
- npm registry + npmjs.com (fetched 2026-08-13): `oxlint` 1.78.0 (2026-08-10), `oxfmt` 0.63.0 (2026-08-10), `vite-plugin-oxlint` 2.1.2 (2026-06-11, peer `vite >=5`, `oxlint >=0.9`), `oxlint-plugin-solidjs` 0.1.1 (2026-02-21), `eslint-plugin-solid` 0.14.5 (peer `eslint ^6–^9`, deps `@typescript-eslint/utils ^7.13.1 || ^8`), `vite-plus` 0.2.9 (bins `oxlint`/`oxfmt`/`vp`, deps `oxlint =1.77.0`, `oxfmt =0.62.0`), `vite-plugin-oxc` (deprecated).
- oxc.rs docs (fetched 2026-08-13): linter quickstart, config, CLI reference, config-file-reference (`jsPlugins`, reserved plugin names), plugins table (defaults: eslint/typescript/unicorn/oxc), js-plugins (alpha, API support, "type-aware not supported"), migrate-from-eslint (`@oxlint/migrate`, `--js-plugins=false`), formatter overview, migrate-from-prettier (`--migrate prettier`, printWidth 100, plugins unsupported, `.prettierignore`/`.gitignore` defaults), config-file-reference (`sortTailwindcss`, `sortImports`, `ignorePatterns`, defaults), unsupported-features, CLI (`--check`, `--list-different`, `--ignore-path`), compatibility matrix (Solid row = JS plugins), blog posts: Oxlint JS Plugins Alpha (2026-03-11), Oxfmt Beta (2026-02-24), Type-Aware Linting Stable (2026-07-22), Oxfmt Alpha (2025-12-01).
- GitHub oxc-project/oxc: release `apps_v1.78.0` (2026-08-10); discussion #19936 (Solid built-in request; `eslint-plugin-solid` jsPlugins config + maintainer confirmation); issues #13894, #20214 (vite.config `.lint`), #20255, #20416, #21295/#21298 (VP_VERSION gating), #22539 (no native vite.config support), #20197 (oxfmt `.fmt` field).
- viteplus.dev: guide/ (what Vite+ is), guide/lint, guide/fmt (config in `lint:`/`fmt:` blocks, tsgolint).
- solidjs-community/eslint-plugin-solid README (rules table; no `no-extra-reactive-context`; flat configs; `solid/imports` package map) — cross-checked with N3 (`N3-lint-format-stack.md`, which also documents `solid-js/web` → `@solidjs/web` in Solid 2 and Tailwind v4 cosmetic-only class order).
