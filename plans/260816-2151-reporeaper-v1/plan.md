---
title: 'RepoReaper v1'
description: 'OSS batch cleaner for personal GitHub repos: list, search, archive or delete via API. One TS monorepo, three fronts: Ink TUI (default), scriptable CLI, React+shadcn web UI (deployable + local).'
status: in-progress
priority: P1
effort: '13-16d'
tags: [cli, tui, web, github-api, oss]
created: 2026-08-16
---

# RepoReaper v1

## Overview

RepoReaper removes or archives **remote GitHub repos** (never touches local disk). Personal repos only (owner = authenticated user), GitHub-only, with a `Provider` interface reserved for GitLab later. Distribution: npm (`npm i -g reporeaper` / `npx reporeaper`).

Design was settled in a 21-question grilling session; decisions below are locked (see Design Decisions). Do not re-litigate them during implementation.

**Architecture in one line:** the web UI talks to a proxy over a small **RPC API** (`/api/repos`, `/api/actions`, `/api/me`) — an allow-list, never a raw GitHub passthrough. The proxy (`createProxyApp` in `core`) uses core's GitHub client server-side. `/api/actions` acts on **one repo per request**; the SPA drives the batch loop, so progress is real and an interrupted batch never loses its record. CLI/TUI call `core` directly (they run where the token is).

**Run modes.** There is no public instance operated by the project. Two ways to run:

- **Local (primary):** `reporeaper ui` mounts the proxy on `127.0.0.1`, token from `.env`/env vars. Also `npx reporeaper` for the TUI. This is the path the README pushes.
- **Self-host (optional):** a "Deploy to Vercel" button lets a user run _their own_ instance. Default is **paste-only** (token in browser memory, sent per request). Server-side `GITHUB_TOKEN` is honored **only when the listener is loopback**; a public self-hosted instance with an ambient token is refused unless the operator sets an access password.

```
reporeaper/                # pnpm workspaces + Turborepo
  packages/
    core/                  # types, GitHub client (base = api.github.com), pagination, actions,
                           #   single-repo executor, createProxyApp (Hono), sanitizeDisplay, shared msw fixtures
    cli/                   # commander + Ink TUI; `reporeaper` = TUI; `reporeaper ui` = mount proxy (loopback) + serve web
    web/                   # Vite + React + Tailwind + shadcn/ui SPA; own thin /api client; drives the batch loop
  api/                     # Vercel serverless entry: depends on core ONLY; api/[...path].ts → RPC routes
```

## Design Decisions (locked)

- Remote deletion only; personal repos only in v1; GitHub-only behind a `Provider` interface (kept as the GitLab seam — user decision).
- Actions: `delete` and `archive` (archive = safe soft-delete, lighter token scope).
- Data source: fetch-all `GET /user/repos` (paginate 100/page); search is client-side **substring** filtering only (no fuzzy). GitHub Search API is explicitly rejected (30 req/min limit + stale index shows just-deleted repos).
- Confirm UX: select N repos → type the number N to confirm; `--yes` for scripting. No per-repo name typing.
- Batch = **one repo per `/api/actions` request**; the client (SPA and CLI) drives the sequential loop, pacing, live progress, and retry. Unlimited batch size, safe under interruption.
- Tokens are never persisted. CLI order: `GITHUB_TOKEN` → `GH_TOKEN` → hidden prompt. Local web: `.env`. Self-hosted web: pasted token, in-memory only (server env token loopback-only).
- No project-operated public instance. "Deploy to Vercel" = user self-hosts their own; README leads with `npx reporeaper` + local `reporeaper ui`.
- Stack: TypeScript everywhere; React (web, **shadcn/ui**) + Ink (TUI); pnpm workspaces + Turborepo; Vite SPA + Hono RPC proxy on Vercel (NOT Next.js).
- Web UI design must go through the `frontend-design` and `hallmark` skills — no generic AI-slop UI.

### Resolved by red team (see Red Team Review)

- Proxy is an **RPC allow-list** (3 named routes), not a raw GitHub passthrough. Core's GitHub client base URL is always `api.github.com`; the web SPA uses its own thin `/api` client. This closes the guardrail-bypass hole.
- `createProxyApp` lives in `core`; `api/` depends on `core` only (no Ink/React/commander in the serverless function). Vercel entry is `api/[...path].ts`.
- Local `reporeaper ui` binds `127.0.0.1`, validates `Host` + `Sec-Fetch-Site`, and requires a per-process session token (anti-CSRF / anti-DNS-rebinding). **Refined during implementation:** the token is injected into the served document instead of the launch URL — a URL is passed to the browser as a command-line argument, readable from the process table by any other local user, and it persists in history.
- Every action re-verifies the selected repo `id` (and `owner.type === 'User'`) before mutating; name-reuse race cannot delete the wrong repo. Repo `name` is `encodeURIComponent`-encoded + charset-gated; `/api/actions` body is schema-validated.
- Rate limiting: mutations paced ≥1s, honor `retry-after`/`x-ratelimit-reset`, secondary-rate-limit is its own error class; `404` on retry-after-success = already-gone (success, not failure).
- Token hygiene = ESLint `no-console` (scoped) + a **runtime sentinel test** across core/cli/api, plus a token wrapper whose `toString`/`toJSON` return `[redacted]`. Wired into CI from Phase 1.

## Goals

| #   | Goal                                                                                                               | Priority |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | Safe batch delete/archive of personal GitHub repos with accurate partial-failure reporting                         | P1       |
| 2   | Three fronts (TUI, CLI, web) sharing one core; ship as a single npm package                                        | P1       |
| 3   | Web UI with real design taste (shadcn/ui + frontend-design + hallmark skills), deployable to Vercel with one click | P2       |

## Phases

| #   | Phase                                                    | Status  |
| --- | -------------------------------------------------------- | ------- |
| 1   | [Monorepo Scaffold](./phase-01-start.md)                 | Done    |
| 2   | [Core Package](./phase-02-core-package.md)               | Done    |
| 3   | [Proxy Layer (RPC)](./phase-03-proxy-layer.md)           | Done    |
| 4   | [CLI and TUI](./phase-04-cli-and-tui.md)                 | Done    |
| 5   | [Web UI](./phase-05-web-ui.md)                           | Done    |
| 6   | [Self-host and Docs](./phase-06-deploy-and-docs.md)      | Done    |
| 7   | [Testing and Release](./phase-07-testing-and-release.md) | Partial |

Dependency chain: 1 → 2 → 3 → 4 → 5 → 6 → 7. Phase 4 owns all of `packages/cli` (including `commands/ui.ts`); Phase 5 owns `packages/web` and sets Vite `outDir` to `../cli/dist/web`, so the end-to-end `reporeaper ui` gate lives in Phase 5 (after the web asset exists), not Phase 4. This removes the earlier false-parallel claim (both phases were editing `commands/ui.ts`).

## Top Risks (carry into every phase)

1. **Wrong-repo deletion = project-killing bug.** Two vectors: (a) intra-UI selection state under filter changes; (b) name-reuse race between listing and action. Both are hard test targets. Mitigation: selection keyed by id everywhere **and** id re-verified before each mutate.
2. **Batch is not a transaction.** The client drives one-repo-per-request so it always knows exactly what completed; retry-remaining is idempotent-aware (404-after-success = already-gone).
3. **Token scope friction + silent truncation.** Fine-grained PATs (a) may see only a subset of repos while looking complete, and (b) can't be scope-checked via `x-oauth-scopes`. Product must surface "token sees N of M" and disable non-`admin` repos before confirm. Docs verified empirically.
4. **Token hygiene.** Leakage can happen in `core` (error serialization), not just the proxy — the sentinel runtime test covers the whole path; token object serializes to `[redacted]`.
5. **Self-host foot-gun.** A publicly-reachable self-hosted instance with a server-side token = unauthenticated delete service. Env token is loopback-only; public self-host requires an access password.
6. **False safety copy.** "Restorable 90 days" is false for fork-network repos; the confirm dialog must warn per-selection using `fork`/`forks_count`.

## Success Criteria

Checked means verified by something that runs. Where verification needed a real
GitHub account or an npm/Vercel credential, the box is left open and the reason
is stated — an unchecked box is the honest record.

- [x] `npx reporeaper` opens the TUI: lists all personal repos, instant search, multi-select, archive/delete with type-the-count confirm — driven through the real components against a simulated GitHub; not yet run against a live account
- [x] `reporeaper delete <pattern> --yes` and `reporeaper archive <pattern> --yes` work non-interactively with exact per-repo result output
- [x] `reporeaper ui` serves the web build + local proxy reading `.env` — verified end to end against the running server
- [ ] The same SPA deploys to Vercel with the serverless proxy — configuration is written but no deployment has been made (needs a Vercel account)
- [x] Tokens never written to disk or logs anywhere in the codebase — the runtime sentinel drives every package with a fake token and scans stdout, stderr, thrown errors, responses, exported values, and a sandboxed filesystem
- [x] Partial batch failure reports precisely which repos succeeded/failed and offers retry of the remainder
- [ ] Published to npm as `reporeaper` — the name is available and the tarball installs and runs standalone (0.38MB, 17 files), but publishing needs an npm credential
- [x] README covers fine-grained PAT setup and an honest self-host/trust model — permissions are taken from GitHub's documentation and labelled as not-yet-measured, with a checklist to confirm them
- [x] Proxy is RPC allow-list; no client-supplied path is concatenated into a GitHub URL — a test asserts the unlisted paths 404
- [x] Sentinel token never appears in any stdout/stderr/error/response across core, cli, api
- [x] Local `reporeaper ui` rejects cross-origin/rebinding requests — confirmed with hand-written HTTP over a raw socket, since fetch refuses to send a forged Host header
- [x] Name-reuse race cannot delete the wrong repo — an integration test renames a repo underneath the batch and asserts the impostor is refused while the rest proceed

## Red Team Review

### Session — 2026-08-16

**Findings:** 15 (15 accepted, 0 rejected) — consolidated from 38 raw across 4 hostile reviewers (Security Adversary, Failure Mode Analyst, Assumption Destroyer, Scope & Complexity Critic).
**Severity breakdown:** 6 Critical, 6 High, 3 Medium.
**Product decisions from user:** no project-operated public instance ("deploy" = user self-hosts); batch = SPA drives one repo per request, unlimited size; `Provider` seam kept.

| #   | Finding                                                                                                                                 | Severity | Disposition | Applied To       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------- | ---------------- |
| 1   | Proxy has two contradictory contracts (passthrough vs RPC); Vercel route matches neither; passthrough bypasses owner guardrail          | Critical | Accept      | Phase 2, 3       |
| 2   | Self-host `GITHUB_TOKEN` env on a public URL = unauthenticated delete service                                                           | Critical | Accept      | Phase 3, 6       |
| 3   | Local `reporeaper ui` CSRF / DNS-rebinding (CORS ≠ request block)                                                                       | Critical | Accept      | Phase 3, 4       |
| 4   | Name-reuse race: select by id, act by name → deletes wrong repo                                                                         | Critical | Accept      | Phase 2, 4, 5    |
| 5   | Server-side single-request batch loses per-item result on interrupt; no live progress                                                   | Critical | Accept      | Phase 2, 3, 5    |
| 6   | 250ms pacing violates GitHub secondary limits; secondary-limit 403 misclassified as permission error                                    | Critical | Accept      | Phase 2          |
| 7   | Phase 4/5 false parallel (shared `commands/ui.ts`); `api/`→`cli` pulls Ink/React into function; missing `api/package.json`              | High     | Accept      | Phase 1, 3, 4, 5 |
| 8   | Web-dist path mismatch across 3 phases; published `reporeaper` 404s on private `@reporeaper/*` deps                                     | High     | Accept      | Phase 1, 5, 7    |
| 9   | Fine-grained PAT sees subset silently + no delete-permission preflight → mass failure after confirm                                     | High     | Accept      | Phase 2, 3, 5, 6 |
| 10  | "Restorable 90 days" false for fork-network repos, shown at confirm                                                                     | High     | Accept      | Phase 5, 6       |
| 11  | `console.` grep is theater (misses stdout.write/logger/serialization; excludes core)                                                    | High     | Accept      | Phase 1, 3, 7    |
| 12  | Self-host docs precede safety gates; no rollback runbook / no-log-drain checklist                                                       | High     | Accept      | Phase 6, 7       |
| 13  | No input validation/encoding (path traversal) + no display sanitization (ANSI/bidi confirm spoof)                                       | Medium   | Accept      | Phase 2, 3, 4, 5 |
| 14  | `/api/me` conflates absent vs bad token; TUI crashes on non-TTY; `web→core` types-only breaks runtime filter; npm-name check unassigned | Medium   | Accept      | Phase 1, 3, 4, 5 |
| 15  | Scope/test/estimate cleanup: drop fuzzy + sortable/stars/size; per-phase test gates; shared msw fixtures; re-estimate 4/5/7             | Medium   | Accept      | Phase 2, 4, 5, 7 |

### Whole-Plan Consistency Sweep

- Files reread: plan.md, phase-01 … phase-07.
- Decision deltas checked: proxy RPC-only + base URL fixed to api.github.com; createProxyApp→core; api entry `api/[...path].ts`; single-repo `/api/actions`; web owns `outDir ../cli/dist/web`; ui.ts owned by Phase 4, e2e gate in Phase 5; no operator public instance; loopback-only env token; token-hygiene runtime test from Phase 1; substring-only filter; dropped sortable/stars/size; effort 13-16d.
- Reconciled stale references: proxy contract (phase-02/03), web dist path (phase-04/05/07), parallelism claim (plan.md), transparency-of-operator copy (phase-06), console-grep mitigation (phase-03/07).
- Unresolved contradictions: 0.

<!-- slug: reporeaper-v1 -->
