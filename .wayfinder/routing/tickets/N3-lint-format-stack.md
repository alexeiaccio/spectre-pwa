---
id: N3
title: Lint + format stack facts for this deployment
type: research
status: closed
blocked_by: []
assigned: dev
---

## Question

Investigate the current best-practice **lint + format** stack for THIS stack (Vite 8, SolidJS 2 beta, Tailwind v4, TypeScript ~6.0, no lint config today) and collect the facts N5 (tooling choice) and N10 (land it) need:

- (a) **`eslint-vite`** (ESLint's official Vite plugin): current state, compatibility with Vite 8, flat-config, editor/HMR behavior.
- (b) **`eslint-plugin-solid`** + solid shared config: flat-config support, Solid 2 (beta) compatibility, key rules (reactivity/`no-extra-reactive-context`, etc.).
- (c) **Prettier + `prettier-plugin-tailwindcss`** for Tailwind v4 class sorting; current plugin status.
- (d) **Biome** as a single lint+format tool — maturity for SolidJS/TSX, flat-ignore, speed; how it compares for this small repo.
- (e) **Exact package list, npm scripts (`lint`, `format`, fix modes), and config file shape** for the winning option.

Write findings to `.wayfinder/routing/research/N3-lint-format-stack.md`. Cite versions and sources.

## Resolution

Findings at `research/N3-lint-format-stack.md`.

- **Correction to the map's premise: `eslint-vite` does not exist.** The npm name is a **security holding package** (`0.0.1-security`); the `eslint` GitHub org has zero Vite repos. Linting runs **standalone** (its own process), optionally with a community dev-overlay (`@nabla/vite-plugin-eslint`, peer eslint `^9||^10`, vite `^4–^8`) — ESLint itself recommends the standalone script.
- **ESLint path has a peer gap right now**: `eslint-plugin-solid@0.14.5` (flat config, `configs/recommended` + `configs/typescript`) declares peer `eslint ^6–^9` — and ESLint 9 hit **EOL 2026-08-06**. ESLint-10 support is an approved-but-unmerged PR (#207, needs `@typescript-eslint/utils ≥ 8.56.0`). Options: pin `eslint@9.39.5` (EOL), install `eslint@10` with `legacy-peer-deps` + track #203/#207, or wait for the plugin release.
- **Prettier 3.9.6** + **`prettier-plugin-tailwindcss` 0.8.1** support Tailwind v4 but need `tailwindStylesheet: "./src/index.css"`; v4 class ordering is cosmetic only.
- **Biome 2.5.8 is a credible single-tool alternative**: native Solid rules (`noSolidDestructuredProps`, `noReactSpecificProps`, `useSolidForComponent`), ~97% Prettier-compatible, much faster — gaps: no Tailwind class sorting, fewer fine-grained Solid reactivity rules.
- Feeds N5 (tooling choice) and N10 (land it).
