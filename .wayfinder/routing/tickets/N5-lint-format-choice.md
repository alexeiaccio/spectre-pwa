---
id: N5
title: Lint + format tooling choice
type: grilling
status: closed
blocked_by: [N3]
assigned: dev
---

## Question

Using N3's facts: confirm the lint + format stack for this repo. The human's leaning (2026-08-13) is **ESLint (flat config, `eslint-vite`, `eslint-plugin-solid`) + Prettier (`prettier-plugin-tailwindcss`)**. The alternative on the table is **Biome** as a single tool.

- Which option; if ESLint+Prettier, confirm the plugin set N3 surfaced.
- Prettier config preferences (semicolons, single quotes, trailing commas) — or defer to the stack's defaults.
- Whether lint/format gates `npm run build` / `npm test` or runs separately.
- Record the choice; rejected option may earn an ADR.

## Resolution

Stack chosen (human, 2026-08-13 — insisted on the Vite integration, i.e. **"vite plus"**):

- **ESLint** (flat config) + **`eslint-plugin-solid`** + **Prettier 3.9.6** + **`prettier-plugin-tailwindcss`** (with `tailwindStylesheet: "./src/index.css"`).
- **Vite integration = `@nabla/vite-plugin-eslint` 3.0.1** — N3 verified `eslint-vite` does not exist (security holding package). nabla is the maintained option: peer `eslint ^9||^10`, `vite ^4–^8`, **serve-mode dev overlay only** (async, non-blocking, cannot fail the build) — so the **standalone `eslint` script stays the gate**.
- **ESLint pinned to `9.39.5`** (EOL 2026-08-06) until `eslint-plugin-solid` PR #207 lands ESLint-10 support; upgrade tracked (solidjs-community/eslint-plugin-solid#203/#207). No `legacy-peer-deps` footgun.
- Prettier matches repo convention: `semi: false`, `singleQuote: true`.
- Scripts `lint` / `lint:fix` / `format` / `format:fix` — **separate from build/test** (no CI yet; CI wiring stays fog on the map).
- Rejected: **Biome** — credible (native Solid rules, single binary) but no Tailwind class sorting and coarser Solid reactivity rules; revisit only if the ESLint-10 gap drags.

## Resolution — REVISED 2026-08-13 (supersedes the ESLint + Prettier choice above)

The human reversed the ESLint/Prettier decision: **"we do not need prettier and eslint. vite plus has oxlint and oxfmt. we can use eslint plugins if needed to."** Final stack:

- **`oxlint` 1.78.0** (linting, zero-config, stable 1.x) + **`oxfmt` 0.63.0** (formatting, beta but 100% Prettier-conformance; **exact-pin** the 0.x).
- **Solid rules via the JS-plugin layer** (`jsPlugins: ["eslint-plugin-solid"]` — the oxc-maintainer-blessed path, oxc#19936). Caveat: `solid/reactivity` is type-aware and degraded/unavailable under oxlint's alpha JS-plugin API; the structural rules (`no-destructure`, `prefer-for`, `jsx-no-duplicate-props`, `jsx-no-undef`, …) are unaffected. This matches the human's "eslint plugins if needed" — the plugin rides in, eslint@9 arrives as an inert auto-installed peer.
- **Vite integration** = `vite-plugin-oxlint` 2.1.2 (peer `vite >=5`, dev-tested on Vite 8) as the dev/build overlay (set `configFile: '.oxlintrc.json'` — its default is dotless). Standalone `oxlint`/`oxfmt` CLI scripts remain the gate. `vite-plus` (Vite+, the unified toolchain product) was explicitly NOT chosen — it pins older oxc (1.77.0/0.62.0) and wants a global CLI; overkill here.
- **Tailwind v4 class sorting** via oxfmt's built-in `sortTailwindcss.stylesheet: "./src/index.css"` — replaces `prettier-plugin-tailwindcss` natively.
- **Config**: `.oxlintrc.json` + `.oxfmtrc.json`; `.oxfmtrc.json` must set `printWidth: 80` (oxfmt default is 100) and `semi:false, singleQuote:true` to match repo style. Scripts `lint`/`lint:fix`/`format`(=`oxfmt --check`)/`format:fix`(=`oxfmt`) — separate from build/test.
- Removed: `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `@nabla/vite-plugin-eslint` wiring, and the seven ESLint/Prettier devDeps.
