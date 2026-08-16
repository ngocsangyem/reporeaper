---
phase: 3
title: 'Proxy Layer (RPC)'
status: completed
priority: P1
dependencies: [2]
effort: '1.5d'
---

# Phase 3: Proxy Layer (RPC)

# Overview

One Hono app (`createProxyApp` in `core`) exposing a small **RPC allow-list** — never a raw GitHub passthrough. It is the `/api/*` surface for the web UI in both run modes: mounted by the CLI on `127.0.0.1` (token from `.env`/env) and exported as a Vercel serverless function (token from a per-request header). Because it lives in `core`, `api/` depends on core alone.

## Requirements

- Functional (allow-list RPC — red team F1):
  - `GET /api/repos` → `listAllRepos()` result incl. the viewer/visibility summary.
  - `POST /api/actions` → acts on **exactly one** repo: body `{action:'delete'|'archive', repo:{id, owner, name}}`; returns one `ActionResult`. The client drives the loop (red team F5). Reject arrays / more than one repo.
  - `GET /api/me` → `{mode:'local'|'byo', tokenState:'absent'|'invalid'|'ok', login?, tokenType?}` (F14). HTTP 200 for ok, 401 only for absent, 403 for invalid — status is not overloaded for mode detection.
  - Body validation: zod/valibot schema on `/api/actions`; unknown fields rejected; `owner`/`name` charset-gated (F13).
  - Server-side guardrail on every action: re-resolve the repo via core's verify (`id` + `owner.login === authedLogin` + `owner.type === 'User'`) before mutating (F4). No route ever concatenates a client-supplied path into the GitHub URL (F1).
- Token resolution: request header `x-github-token` wins (self-host paste mode); else server env `GITHUB_TOKEN`/`GH_TOKEN` — **only honored when the listener is loopback** (F2). Absent → 401.
- Local-mode request hardening (F3), active whenever bound to loopback:
  - Bind `127.0.0.1` explicitly (never `0.0.0.0`).
  - Reject requests whose `Host` is not `127.0.0.1:PORT`/`localhost:PORT` (anti-DNS-rebinding).
  - Require `Sec-Fetch-Site: same-origin` (or absent) AND a per-process random session token (printed in the launch URL, echoed as a header) — kills simple-request CSRF.
- Non-functional (trust contract): zero logging of headers/bodies/tokens anywhere; no `hono/logger`; no analytics/error-reporter capturing requests; token lives only in request scope (never disk/cache/KV). CORS same-origin. For a public self-host, refuse env-token startup unless `REPOREAPER_ACCESS_PASSWORD` is set (F2).

## Architecture

```
packages/core/src/proxy/app.ts   # createProxyApp({resolveToken, isLoopback, sessionToken?})
api/[...path].ts                 # Vercel entry: hono/vercel adapter over createProxyApp; matches /api/* (F1 fix)
vercel.json                      # rewrite /api/(.*) → the function; everything else → static SPA; functions.maxDuration set
```

Local mode mounts the same app via `@hono/node-server` in Phase 4's `ui` command with `isLoopback: true` + a generated `sessionToken`. Deployed mode runs with `isLoopback: false`.

## Related Code Files

- Create: `packages/core/src/proxy/app.ts`, `api/[...path].ts`, `api/package.json`, `vercel.json`
- Modify: `packages/core/package.json` (hono dep), core barrel export

## Implementation Steps

1. `createProxyApp` with the three RPC routes calling core's provider; base `api.github.com`.
2. Token middleware: header → (loopback-only) env → 401; attach provider to context; structured `/api/me`.
3. zod body schema + owner/id server-side verify on `/api/actions` (single repo only).
4. Loopback hardening middleware (Host + Sec-Fetch-Site + session token); public env-token password gate.
5. Vercel adapter `api/[...path].ts` + `vercel.json` (rewrite + `maxDuration`).
6. Tests: header beats env; env ignored when non-loopback; no-token 401 vs invalid 403; owner/id mismatch → 403 no forward; rebinding Host rejected; cross-site POST without session token rejected; runtime sentinel test asserts no token in any output; multi-repo body rejected.

## Success Criteria

- [x] Only the 3 named routes exist; no path pattern forwards arbitrary GitHub paths (F1)
- [x] `/api/actions` accepts exactly one repo and verifies id+owner before mutating; mismatch → 403, nothing forwarded
- [x] Env token is ignored unless loopback; public env-token start refused without access password
- [x] Cross-origin / rebinding / missing-session-token requests to local mode are rejected
- [x] Sentinel token absent from all emitted output in the proxy path

## Risk Assessment

Medium-high — this file is the trust boundary. Risk: a future debug log leaks tokens → the runtime sentinel test (not a grep) fails CI on any leak, across core/cli/api (F11). Assumption: `hono/vercel` adapter serves `/api/*` via `api/[...path].ts` + rewrite; verify against Hono's current Vercel guide during step 5 (signal: SPA calls hit the static 404 fallback → fix the rewrite/entry before Phase 5 integration). Loopback env-token + rebinding guards make the local endpoint safe against a malicious page while `ui` is open.
