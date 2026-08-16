---
phase: 4
title: 'CLI and TUI'
status: completed
priority: P1
dependencies: [3]
effort: '4d'
---

# Phase 4: CLI and TUI

## Overview

The `reporeaper` npm binary. Bare invocation opens the Ink TUI (list → search → multi-select → archive/delete → type-the-count confirm → client-driven batch → report/retry). Non-interactive `delete`/`archive` for scripting. `reporeaper ui` mounts the loopback proxy and serves the web build. Phase 4 **owns all of `packages/cli`, including `commands/ui.ts`** (red team F7); the end-to-end `ui` gate is verified in Phase 5 once the web asset exists.

## Requirements

- Functional:
  - `reporeaper` (bare) → Ink TUI, **only if a TTY is present**. Without a TTY (piped/CI) print usage + "set GITHUB_TOKEN and use `reporeaper delete <pattern> --yes`" and exit 2 (red team F14). Same guard for the masked prompt.
  - `reporeaper delete <pattern>` / `archive <pattern>` → non-interactive; print matched repos, then per-repo results; exit 1 if any failed.
  - `reporeaper ui [--port 7433]` → generate a per-process session token, mount the proxy with `isLoopback:true` bound to `127.0.0.1`, serve the web build, open browser at the URL carrying the session token (F3). On busy port, report the owner PID (process-management rule), don't auto-increment.
  - Token resolution: `GITHUB_TOKEN` → `GH_TOKEN` → hidden masked prompt (memory only, never persisted); via core's redacting wrapper.
  - Batch is **client-driven**: the CLI loops selected repos one at a time through core's `runAction` + `pace()` (≥1s mutations), honoring `retry-after` on secondary-rate-limit, rendering per-repo ✓/✗, and computing a retry-remaining set that treats 404-after-verified-delete as already-gone (F4, F6). Every repo is id-verified before mutation.
  - All provider strings passed through `sanitizeDisplay` before Ink render; confirm screen shows count N + repo `id` alongside name; fork/`forks_count`>0 repos flagged "not restorable" (F10, F13).
- Non-functional: repo lists up to ~1000 items scroll smoothly — windowed rendering (Ink has no built-in virtualization; hardest UI work here).

## Architecture

```
packages/cli/src/
  index.ts               # commander; bare argv + isTTY guard → render(<App/>)
  token.ts               # env-chain + masked prompt (redacting wrapper; never persisted)
  commands/delete.ts     # shared client-driven runner with archive (action param); pacing + retry
  commands/ui.ts         # @hono/node-server + createProxyApp(isLoopback,sessionToken) + serve dist/web + open
  tui/app.tsx            # state machine: loading → list → confirm → running → report
  tui/repo-list.tsx      # windowed list + search + multi-select (selection keyed by id)
  tui/confirm.tsx        # type-the-count gate; shows id + not-restorable warnings
  tui/report.tsx         # per-repo results + retry remaining
```

CLI/TUI call `@reporeaper/core` directly (no proxy hop — they run where the token is). `commands/ui.ts` resolves the web asset via `new URL('./web', import.meta.url)` against `dist/web` (single canonical path — F8).

## Related Code Files

- Create: files above; `packages/cli/package.json` `bin:{reporeaper:dist/index.js}`, tsup build with `noExternal:['@reporeaper/core']` (F8)

## Implementation Steps

1. commander skeleton + isTTY guard + token resolution.
2. Non-interactive `delete`/`archive` client-driven runner (cheapest end-to-end path; test bed for pacing, retry, exit codes).
3. Ink TUI state machine; windowed `repo-list` with search + id-keyed selection.
4. Confirm (count + id + not-restorable flags) + progress + report/retry.
5. `ui` command: session token, loopback mount, serve `dist/web`, open browser, busy-port handling.
6. Tests (ink-testing-library + msw): selection integrity (filter → select → change filter → act on exactly the chosen ids); wrong count refuses; secondary-limit pacing/backoff; 404-after-success = done not failed; non-TTY exits 2.

## Success Criteria

- [x] Selection-integrity test: filter, select 3, change filter, run → exactly those 3 ids acted on
- [x] Wrong count refuses; `--yes` bypasses confirm only in non-interactive commands
- [x] Non-TTY invocation prints guidance and exits 2 (no Ink raw-mode crash)
- [x] Client-driven batch paces mutations ≥1s, backs off on secondary limit, reports already-gone correctly
- [x] Exit code 1 on partial batch failure in scripting mode

## Risk Assessment

High-effort UI. Windowed Ink list is fiddly (flicker, focus) — timebox; degraded fallback = hard render cap + "refine your search" hint (signal: unusable lag over ~300 rows). Selection-state + name-reuse are the top product risks — Step 6 tests plus core's id-verify are the non-negotiable gates. `commands/ui.ts` is owned here but its live end-to-end verification is a Phase 5 success criterion (web asset dependency).
