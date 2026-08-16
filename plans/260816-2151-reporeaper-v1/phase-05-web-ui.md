---
phase: 5
title: 'Web UI'
status: pending
priority: P1
dependencies: [4]
effort: '4d'
---

# Phase 5: Web UI

## Overview

Vite + React SPA with **Tailwind + shadcn/ui**, talking to the RPC proxy via its own thin `/api` client (not core's GitHub client — red team F1). One build serves both modes: self-host (token-paste gate) and local via `reporeaper ui`. The SPA **drives the batch loop** one repo per request. This is the public face — design must have "vị", not default-shadcn slop. Phase 5 owns `packages/web` and sets Vite `outDir` to `../cli/dist/web`, and owns the end-to-end `reporeaper ui` verification (F7, F8).

## Requirements

- Functional:
  - Mode detection via `GET /api/me` reading the structured body (F14): `mode:'local'` → skip token gate; `mode:'byo'` + `tokenState:'absent'` → show gate; `tokenState:'invalid'` → show gate with "token rejected" (never the localhost self-host pitch on a local instance).
  - A single global 401/invalid interceptor in `api/client.ts` re-runs mode detection and re-shows the correct gate when a token expires mid-session (F14).
  - Token gate (self-host): paste PAT → React state only (no localStorage/cookies), sent as `x-github-token` per request; link to the fine-grained PAT guide; honest notice "kept in memory, sent per request; you are running your own instance".
  - Repo table: name, visibility, fork badge, archived badge, last push. **No sortable columns, stars, or size in v1** (F15 — unrequested, and sorting inflates the selection-integrity surface). Instant client-side substring search; checkbox multi-select + select-all-filtered; selection keyed by repo id.
  - Subset-token banner: when `/api/me`/`/api/repos` reports the token sees fewer repos than the account total, show a persistent "this token can see N of M repositories" banner (F9). Repos without `permissions.admin` render as disabled checkboxes with a reason (F9).
  - Action bar Archive/Delete → confirm dialog listing the selection (strings via `sanitizeDisplay`, showing id), requiring the count N typed; per-selection warning "K of these cannot be restored" computed from `fork`/`forks_count` (F10, F13).
  - Batch: SPA loops the selection, one `POST /api/actions` per repo, paced ≥1s for mutations, honoring `retry-after`; live per-repo status; final report with failed items + retry-remaining (already-gone handled) — durable because the client owns per-item state (F5).
- Non-functional: keyboard accessible, responsive; strict CSP shipped via `vercel.json` headers (`default-src 'self'; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`) + `X-Content-Type-Options`, `Referrer-Policy: no-referrer` (F7-security). Token never reachable from `window`.

## Design Process (mandatory, in order)

1. **Invoke the `hallmark` skill** for the greenfield design pass: direction, type, color, layout — an identity for a "reaper" tool (dark, sharp, deliberate; destructive actions styled with intent).
2. **Invoke the `frontend-design` skill** when composing screens/components so the implementation keeps that taste (states, spacing, motion restraint).
3. shadcn/ui is the base (table, dialog, command, toast, badge, checkbox) themed via CSS variables to the hallmark direction — never stock defaults.
4. Delete confirm is the signature moment: count-typing gate, red reserved exclusively for delete, calmer treatment for archive, explicit not-restorable callout.

## Architecture

```
packages/web/src/
  api/client.ts          # thin fetch → /api/* RPC; attaches x-github-token from state; global 401 interceptor
  state/session.ts       # mode + tokenState + token (memory only) — React context
  state/selection.ts     # selection keyed by repo id, immune to filter changes
  batch/run-batch.ts     # client-driven loop: one repo/request, pacing, retry-remaining
  screens/token-gate.tsx
  screens/repo-table.tsx
  screens/confirm-dialog.tsx
  screens/batch-report.tsx
  components/ui/*         # shadcn generated
vite.config.ts           # build.outDir '../cli/dist/web', emptyOutDir
```

## Related Code Files

- Create: files above; `packages/web/index.html`, `tailwind.config.ts`, `components.json`
- Modify: `vercel.json` (CSP + security headers); verify `packages/cli/src/commands/ui.ts` serves `dist/web` end-to-end (owned by Phase 4, gated here)

## Implementation Steps

1. Vite + Tailwind + shadcn init; `outDir ../cli/dist/web`; run hallmark pass; encode direction as theme tokens.
2. `api/client.ts` (RPC + global 401 interceptor) + session/mode detection + token gate.
3. Repo table (name/visibility/fork/archived/last-push) with substring search + id-keyed multi-select + subset banner + admin-disabled rows.
4. Confirm dialog (count gate + id + not-restorable) + `run-batch.ts` client loop + report/retry (frontend-design skill active).
5. Selection-integrity, confirm-gate, and no-token-in-window tests (vitest + testing-library, msw for `/api/*`).
6. Vite dev `server.proxy → 127.0.0.1:7433`; then build and verify `reporeaper ui` serves `dist/web` end-to-end with an `.env` token.

## Success Criteria

- [ ] One build works in both modes (gate only when `/api/me` mode=byo & token absent/invalid)
- [ ] Token exists only in memory, unreachable from `window`; refresh = re-paste (test-verified)
- [ ] Selection-integrity test passes (filter change never mutates selection; actions target selected ids)
- [ ] Subset-token banner + admin-disabled rows appear for a restricted fine-grained PAT
- [ ] Confirm dialog warns on non-restorable (fork) repos; strings sanitized
- [ ] `reporeaper ui` serves the built SPA end-to-end (the Phase 4 `ui` command's live gate)
- [ ] UI reviewed against hallmark direction — no stock-shadcn look; delete/archive visually distinct

## Risk Assessment

Medium. "Design taste" is subjective — mitigated by running hallmark first and reviewing against its output. UX: refresh loses the pasted token (accepted no-storage trade-off; gate must make re-paste a 5-second act). Assumption: `GET /user` works for fine-grained PATs to detect login/type (true); signal broke: 403 on `/api/me` with a valid token → lenient mode probe. Dropping sortable/stars/size buys back the design-pass time and shrinks the #1-risk surface.
