# Changelog

## 0.1.0 — unreleased

First release.

### Added

- **Terminal UI** (`npx reporeaper`) — lists every personal repository, instant
  substring search, multi-select, archive or delete behind a type-the-count
  confirmation. Refuses to start without a TTY and explains the scriptable
  alternative instead of crashing.
- **Scriptable commands** — `reporeaper delete <pattern> --yes`,
  `reporeaper archive <pattern> --yes`, and `--dry-run`. Exits `1` when any
  repository failed.
- **Local web UI** (`reporeaper ui`) — the same workflow in a browser, served
  from `127.0.0.1` with a per-process session token, reading the token from the
  environment or `.env`.
- **Self-hosting** — the SPA and an RPC proxy deploy together to Vercel,
  paste-only by default, with no environment variables required.

### Safety

- Selection and every mutation are keyed by repository id, and each action
  re-reads the repository to confirm the id, the owner login, and that the owner
  is a personal account before touching it. A name that has come to mean a
  different repository is refused, not deleted.
- Batches run one repository per request, paced a second apart, so an
  interrupted run still reports exactly what completed. A delete that 404s on
  retry counts as already gone rather than as a failure.
- The proxy is an allow-list of three operations, never a GitHub passthrough.
- A server-side token is honored only on a loopback listener; a publicly
  reachable instance holding one refuses to serve unless an access password is
  set.
- Tokens are never written to disk, storage, or logs. A runtime sentinel test
  drives every package with a fake token and fails CI if it surfaces anywhere,
  and the harness self-tests against known-hard leak shapes so it cannot quietly
  stop detecting them.
- Repository names and descriptions are stripped of ANSI and bidi control
  characters before display, so a hostile name cannot redraw or reorder a
  confirmation prompt.
- Fork-network repositories are flagged as not restorable, because GitHub's
  90-day restore does not cover them.
