---
phase: 2
title: 'Core Package'
status: completed
priority: P1
effort: '2.5d'
dependencies: [1]
---

# Phase 2: Core Package

## Overview

`@reporeaper/core`: types, a dependency-light GitHub client (plain `fetch`, base always `api.github.com`), fetch-all pagination, single-repo delete/archive actions with id-verification, a client-driven executor contract, rate-limit-aware error mapping, display sanitization, and shared msw fixtures. `createProxyApp` also lives here (see Phase 3) so `api/` depends only on core.

## Requirements

- Functional:
  - `Provider` interface (GitHub is the only implementation in v1; GitLab slot reserved — user decision).
  - `listAllRepos()`: paginate `GET /user/repos?affiliation=owner&per_page=100` via `Link` header until exhausted. Returns repos **plus** a `visibility` summary: token type (classic/fine-grained), and `{seen: number, accountTotal?: number}` from `GET /user` (`public_repos + total_private_repos`) so callers can warn when the token sees a subset (red team F9). Never combine `type` with `affiliation` (422).
  - Per-repo `permissions.admin` is preserved on each `Repo` (from the list response) so UIs can disable non-deletable repos before confirm (F9).
  - Actions act on **one repo**: `deleteRepo(repo)` → verify then `DELETE /repos/{owner}/{name}`; `archiveRepo(repo)` → verify then `PATCH /repos/{owner}/{name}` `{archived:true}`. "Verify" = `GET /repos/{owner}/{name}`, confirm `id === repo.id` and `owner.type === 'User'` and `owner.login === authedLogin`; on mismatch return a `changed-since-listing` result and do NOT mutate (red team F4, F13).
  - Path safety: every path segment `encodeURIComponent`-encoded; `name` gated by `^[A-Za-z0-9._-]{1,100}$` and `owner` likewise before any fetch (F13).
  - Executor contract: the **caller** drives the loop (SPA and CLI both call one action at a time). Core exposes `runAction(repo, action)` returning `{repo, action, ok, error?, code}` and a small `pace()` helper (default 1000ms between mutations — F6). No server-side whole-batch runner exists.
  - Error mapping (`errors.ts`), distinct classes: `401 absent/invalid` (split, F14); `403 permission`; `404 not-found` (on a retry-after-success, caller maps to `already-gone` = success, F4); `secondary-rate-limit` = 403/429 carrying `retry-after` or body text "secondary rate limit" (NOT keyed on `x-ratelimit-remaining` — F6); `primary-rate-limit` = `x-ratelimit-remaining: 0`. Rate-limit classes expose the reset/`retry-after` value.
  - `sanitizeDisplay(str)`: strip C0/C1 + ANSI CSI/OSC, strip bidi overrides (U+202A–202E, U+2066–2069), NFKC-normalize, hard-truncate. Applied to every provider string before any renderer (F13).
  - Token wrapper: token stored in an object whose `toString`/`toJSON` return `[redacted]` (F11); `filter.ts`: case-insensitive **substring** over name + description (no fuzzy — F15).
- Non-functional: zero heavy deps (no Octokit); core never reads env, never persists, never logs the token.

## Architecture

```
packages/core/src/
  types.ts             # Repo (incl. id, owner.type, permissions.admin, fork, forks_count), RepoAction, ActionResult, ProviderError
  provider.ts          # Provider interface
  token.ts             # redacting token wrapper
  github/client.ts     # fetch wrapper: auth header, base = api.github.com (NOT injectable to a proxy path — F1)
  github/pagination.ts # Link-header walker
  github/provider.ts   # GitHubProvider: listAllRepos, getRepo (verify), deleteRepo, archiveRepo, getViewer
  actions.ts           # runAction(repo, action) with pre-mutate id/owner verification; pace()
  filter.ts            # client-side substring search
  errors.ts            # status/headers/body → typed error class
  sanitize.ts          # sanitizeDisplay
  proxy/app.ts         # createProxyApp (implemented in Phase 3)
  __tests__/fixtures/  # shared msw handlers: pagination Link headers, 403 variants, secondary-limit shape (F15)
```

## Related Code Files

- Create: all files above + `packages/core/src/index.ts` barrel; tests written alongside and gated by this phase's own CI (F15).

## Implementation Steps

1. `types.ts` + `Provider` interface + redacting `token.ts` first.
2. fetch client (base `api.github.com`), `X-GitHub-Api-Version` + `Accept` headers.
3. Link-header pagination + `listAllRepos()` + `getViewer()` (login + counts + token type).
4. `getRepo()` verify + `runAction()` with pre-mutate id/owner check + path encoding/charset gate.
5. `errors.ts` typed classes (split 401 absent/invalid, 403 permission, 404, secondary/primary rate limit).
6. `sanitize.ts` + `filter.ts` (substring only).
7. Shared msw fixtures; tests: >100-repo pagination; each error class incl. secondary-limit (403 + `retry-after`, no ratelimit headers); id-mismatch abort; 404-on-verified-delete → already-gone; sanitize strips `\x1b[2A\r` and `‮`.

## Success Criteria

- [x] Secondary-rate-limit 403 maps to its own class, never to "permission" (msw test)
- [x] `runAction` aborts with `changed-since-listing` when the live repo id ≠ selected id
- [x] `getViewer` reports token type + seen/account counts so a subset token can be flagged
- [x] Grep + runtime sentinel test prove core never logs the token and serializes it as `[redacted]`
- [x] Pagination returns >100 repos correctly; filter is substring-only (no fuzzy dep)

## Risk Assessment

Medium. Wrong error mapping (403 = permission | secondary-limit | SSO) misleads users — mitigated by explicit per-case msw tests. Assumption: fine-grained PAT delete uses `Administration: write`; this is **verified empirically in Phase 6 step 1** before the docs/error strings hard-code it (F9). Signal it broke: a verified Administration:write token still 403s on delete → revise error copy + token guide from the measured result.
