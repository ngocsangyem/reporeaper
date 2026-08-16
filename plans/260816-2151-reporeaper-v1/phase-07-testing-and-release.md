---
phase: 7
title: 'Testing and Release'
status: partial
priority: P1
dependencies: [6]
effort: '2d'
---

# Phase 7: Testing and Release

## Overview

Cross-package integration + release. Each earlier phase already gates its own unit tests (F15); Phase 7 owns cross-package E2E, the whole-path token-hygiene assertion, tarball verification, and the npm publish.

## Requirements

- Functional:
  - Cross-package E2E green on a real throwaway account: TUI archive+delete, scripted `delete --yes`, `reporeaper ui` local (loopback + session token), and a preview self-host (paste-only).
  - Token-hygiene gate (F11): the runtime **sentinel test** (drive full request/action paths with a sentinel token, assert it never appears in any stdout/stderr/thrown-error/response) runs across core, cli, and api in CI; plus the scoped ESLint `no-console`/no-`hono/logger` rule. This is a merge gate, not a release-only step.
  - Release: `web` build already lands in `packages/cli/dist/web` via Vite `outDir` (no separate copy script — F8); cli bundles `@reporeaper/core` via tsup `noExternal`; the Phase-1 pack-and-install CI step asserts no `@reporeaper/*` remain in the tarball deps; publish `reporeaper` (public) with `--provenance`; `core`/`web` stay private.
  - Manual name-reuse / interruption E2E: rename a repo mid-session and confirm the id-verify aborts; kill the client mid-batch and confirm the report reflects exactly what completed.
- Non-functional: `npx reporeaper` cold-start acceptable; tarball lean (web dist is the main weight; keep < ~2MB).

## Architecture

Publish shape: single npm package `reporeaper` = compiled CLI (core inlined via tsup), built SPA under `dist/web/`, `bin` entry. GitHub Actions: CI (from Phase 1, incl. token-hygiene + pack-install) + a manual-trigger release workflow (build → test → pack → `npm publish --provenance`).

## Related Code Files

- Create: `.github/workflows/release.yml`, `CHANGELOG.md` (wired to the release workflow for the single 0.1.0 release; no changesets ceremony)
- Modify: `packages/cli/package.json` (`files:['dist']`, `version 0.1.0`); CI already carries the hygiene + tarball steps (Phase 1)

## Implementation Steps

1. Close any cross-package E2E gaps (per-phase unit gates already enforced). Selection-integrity, name-reuse abort, and interruption reporting are the hard gates.
2. Confirm the token-hygiene runtime sentinel test covers core+cli+api in CI.
3. Verify `reporeaper ui` works from a packed tarball (`npm i -g ./reporeaper-0.1.0.tgz`) — resolves `dist/web` via `import.meta.url` in a global install (F8).
4. Manual E2E checklist on throwaway repos (all fronts + self-host preview + name-reuse + interruption).
5. Tag `v0.1.0`, run release workflow, verify `npx reporeaper@0.1.0` from the registry on a clean machine.

## Success Criteria

- [ ] `npx reporeaper@0.1.0` on a clean machine opens the TUI and completes an archive on a throwaway repo
- [ ] Tarball: no `.env`/secrets, web dist present, no `@reporeaper/*` deps, size sane
- [ ] Token-hygiene sentinel test (core+cli+api) + scoped lint are active merge gates and green
- [ ] Name-reuse abort and mid-batch-interruption reporting verified manually
- [ ] All plan.md success criteria checked off

## Risk Assessment

Medium. npm bin + ESM + bundled static assets has papercuts (shebang, `import.meta.url` path resolution in global installs) — mitigated by testing the packed tarball (Phase 1's pack-install step catches most of it earlier). Name `reporeaper` taken → already pre-checked in Phase 1 step 0; fallback scope locked before docs were written.

## Outcome

Everything that does not require a credential is done and verified. The release
itself is not: publishing needs an npm token and the live E2E needs a real
GitHub account. Both are left for a human rather than faked.

**Done and verified**

- Cross-package integration tests (`packages/cli/src/__tests__/integration.test.ts`)
  cover the two hard gates against a simulated GitHub: a repository renamed
  between listing and action is refused while the rest of the batch proceeds,
  and an interrupted run records an outcome for every repository including the
  one that failed. A third case proves that retrying an already-deleted
  repository reports already-gone rather than failing.
- `reporeaper ui` verified end to end against the running server: it serves the
  built SPA, the API refuses requests without the session token, and a
  hand-written HTTP request carrying a forged `Host` header is rejected with
  `forbidden_host`. fetch cannot forge that header, so this needed a raw socket.
- The token-hygiene sentinel runs across core, cli and api on every CI run, and
  self-tests first against five known-hard leak shapes.
- `pnpm verify:tarball` packs, checks the manifest for private workspace
  dependencies across all three dependency maps, installs into a clean project
  outside the workspace, runs the installed bin, and enforces a 2MB budget.
  Current: 0.38MB, 17 files.
- `.github/workflows/release.yml` is manual-dispatch only, re-runs the full
  gate, refuses to publish when the tag and the package version disagree, and
  publishes with provenance.

**A real bug this phase caught.** The tarball gate failed with an empty version
string, which turned out to be the direct-run guard in `bin.ts` comparing raw
paths. An installed package is invoked through a `.bin` symlink, so the
comparison was false and the CLI did nothing at all — every global install would
have been a silent no-op. Both sides now resolve through realpath. Only
installing the tarball outside the workspace surfaces this.

**Not done, and why**

- Publishing to npm: needs an npm credential. The workflow is ready; a human
  runs it.
- `npx reporeaper@0.1.0` from the registry on a clean machine: follows publish.
- A preview self-host deploy on Vercel: needs a Vercel account.
- The manual E2E against a live throwaway account, and the empirical
  confirmation of fine-grained PAT permissions owed from phase 6 step 1: both
  need a real GitHub token. The measurement checklist is in
  `docs/token-guide.md`.
