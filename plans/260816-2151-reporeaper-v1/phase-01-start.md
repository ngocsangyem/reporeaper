---
phase: 1
title: 'Monorepo Scaffold'
status: completed
priority: P1
effort: '1d'
dependencies: []
---

# Phase 1: Monorepo Scaffold

## Overview

Stand up the pnpm + Turborepo monorepo with three packages (`core`, `cli`, `web`) and the `api/` serverless entry, shared TS config, lint (including token-hygiene rules), CI skeleton, and a released-name pre-check.

## Requirements

- Functional: `pnpm build` / `pnpm test` / `pnpm lint` run across all workspaces via Turbo. CI runs the token-hygiene checks from day one (they must exist before any proxy/token code is written — red team F11).
- Non-functional: Node >= 20, strict TypeScript, ESM-only packages.

## Architecture

```
package.json            # private root, pnpm workspaces
pnpm-workspace.yaml     # packages/*, api
turbo.json              # build/test/lint pipelines; cli#build depends on @reporeaper/web#build + ^build
tsconfig.base.json      # strict, ESM, bundler moduleResolution
packages/core/          # @reporeaper/core   (private; consumed by cli, web, AND api)
packages/cli/           # reporeaper         (the ONLY published package; bundles core via tsup noExternal)
packages/web/           # @reporeaper/web    (private; Vite build outputs to ../cli/dist/web)
api/                    # Vercel function entry; depends on @reporeaper/core ONLY (no cli)
```

`web` depends on `core` as a **normal runtime dependency** (it imports `filter.ts` + types at runtime — red team F14), not types-only. `api/` imports `createProxyApp` from `core`, never from `cli`, so the serverless function never pulls in Ink/React/commander (red team F7).

## Related Code Files

- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `.editorconfig`
- Create: `packages/{core,cli,web}/package.json`, `api/package.json` (F7 — it is a workspace member and needs its own manifest), `packages/{core,cli}/tsconfig.json`, `packages/{core,cli}/src/index.ts` (stubs)
- Create: `.github/workflows/ci.yml` (install → lint → build → test → token-hygiene → pack-and-install tarball)
- Create: `eslint.config.js` with an override scoped to `packages/*/src/server/**`, `packages/core/src/**`, and `api/**`: `no-console: error` + `no-restricted-imports` banning `hono/logger` (F11)

## Implementation Steps

1. **Step 0 — name pre-check (F14):** `npm view reporeaper`. If taken, lock the fallback scope `@reporeaper/cli` before any doc references the name; record the decision here.
2. Init git repo (first commit), root `package.json` (private) + `pnpm-workspace.yaml` including `api`.
3. Add Turborepo tasks `build`/`test`/`lint`/`dev`; wire `cli#build` to depend on `@reporeaper/web#build` and `^build` (F8 — web asset must exist before cli packs).
4. Create the four manifests + stub `src/index.ts`; wire deps: `cli`→`core`, `web`→`core` (runtime), `api`→`core`.
5. Shared `tsconfig.base.json` (strict, `moduleResolution: bundler`, all packages `"type": "module"`); prettier.
6. ESLint flat config with the server/core/api override above.
7. CI workflow: pnpm cache, `turbo lint build test`, then `pnpm audit --audit-level=high`, then `npm pack` the cli + install the tarball into a temp dir and assert its `dependencies` contains no `@reporeaper/*` (F8).
8. Add `.env.example` with `GITHUB_TOKEN=` (never commit `.env`).

## Success Criteria

- [x] `pnpm i && pnpm build && pnpm test && pnpm lint` all green on a clean clone
- [x] `npm view reporeaper` result recorded; final published name locked
- [x] CI passes and includes the token-hygiene lint + pack-and-install-tarball steps
- [x] `api/` builds with only `@reporeaper/core` in its dependency closure (no Ink/React/commander)
- [x] `.env` is git-ignored; `.env.example` documents the token variable

## Outcome

**Step 0 — name pre-check.** `npm view reporeaper` returned E404 (unpublished) on
2026-08-16, as did `@reporeaper/cli`. The published name is locked to
**`reporeaper`**; the fallback scope was not needed.

Both token-hygiene layers were negative-tested rather than assumed:

- The runtime sentinel harness (`scripts/token-hygiene.mjs` +
  `token-hygiene-probe.mjs`) was run against a deliberately leaky module and
  caught all three vectors — stdout write, HTTP response body, exported value.
  It probes core, cli, cli/bin, and the serverless entry (bundled on the fly,
  since that entry ships as TypeScript).
- The scoped ESLint `no-console` rule was confirmed to fire on a temporary file
  under `packages/core/src/`.
- `scripts/verify-tarball.mjs` was negative-tested by moving `@reporeaper/core`
  into runtime dependencies; it reports the private dependency by name instead
  of surfacing npm's resolution crash.

Two ordering hazards found and fixed during implementation:

- tsup `clean: true` in the cli would have deleted `dist/web` written by the
  earlier web build. Clean patterns are relative to `outDir` and support
  negation, so the cli uses `clean: ['!web/**']`.
- `@reporeaper/web#build` writes outside its own package, so a turbo cache hit
  could have skipped producing `dist/web` on a fresh checkout. That task is now
  `cache: false`.

The web build is a placeholder script that writes to the final location
(`packages/cli/dist/web`); phase 5 replaces it with Vite using the same output
directory, so the cross-package wiring is exercised from phase 1.

## Review Outcomes

A code review of the scaffold found the gates themselves defective. Fixed:

- **CI was red as committed** — `pnpm audit --audit-level=high` failed on a
  critical/high in the vitest→vite chain. Resolved by upgrading rather than
  scoping the audit: vitest 4 pulls rolldown native bindings that pnpm blocks,
  so the workspace sits on vitest 3.2.7, which audits clean at high+.
- **The sentinel scan missed `util.inspect`** — the very function
  `console.log`/`console.error` and Node's uncaught-exception printer use, and
  the only one that sees private and non-enumerable state. A token in a `Map`
  or an `Error` cause slipped through.
- **A single unterminated stdout write disabled all leak reporting** — the
  child's report line could be spliced onto module output. Findings now go to a
  JSON report file, immune to stream interleaving.
- **`eslint.config.js` was in no turbo hash** — the lint gate could be weakened
  and still report `FULL TURBO`. Added `globalDependencies`.
- **`reporeaper#build` cached `dist/web`** — a cache hit would restore stale web
  assets over the fresh build. Outputs now exclude it.
- **Three ESLint escape hatches** — a broad `**/scripts/**` / `**/*.config.ts`
  override switched `no-console` off inside token-handling trees, and the globs
  covered `.ts` only, so `.tsx`/`.mjs` were unguarded. All four now error;
  `packages/cli/src/bin.ts` still prints, as the CLI must.

`scripts/token-hygiene-selftest.mjs` now runs before the gate in `pnpm hygiene`,
asserting five known-hard leak shapes are caught and two safe shapes are not.

**Design constraint discovered for phase 2:** a token in a true `#private` field
is unreachable by `String`, `JSON.stringify`, and `inspect` alike — but the same
wrapper leaks immediately if it also mirrors the value on a public property.
`token.ts` must use a private field with no public mirror. Both directions are
pinned as self-test cases.

**Deferred harness work** (the gate does not cover these yet; the header says so
rather than implying broader coverage):

- Phase 3/4: a token passed to a spawned grandchild process is unobserved.
- Phase 4: the probe imports `dist/bin.js`; once that is an interactive TUI it
  needs a non-interactive entry to drive. Spawn timeouts are already in place.
- Any phase adding network egress: a token sent over the wire is not detectable
  here.

## Risk Assessment

Low. Trap: ESM/CJS mismatch between Ink (ESM) and commander — locked by all packages `"type": "module"`. Signal it broke: `ERR_REQUIRE_ESM` downstream → fix package config here. Second trap: cli→core bundling; verified by the pack-and-install CI step, not by workspace-local runs (F8).
