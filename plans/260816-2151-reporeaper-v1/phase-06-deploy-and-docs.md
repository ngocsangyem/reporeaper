---
phase: 6
title: 'Self-host and Docs'
status: pending
priority: P2
dependencies: [5]
effort: '1.5d'
---

# Phase 6: Self-host and Docs

## Overview

There is **no project-operated public instance**. This phase ships the optional self-host path (a "Deploy to Vercel" button so a user runs _their own_ instance) and the trust-critical docs: empirically-verified fine-grained PAT guide, honest self-host security model, and the fork-network restore caveat. README leads with `npx reporeaper` + local `reporeaper ui`.

## Requirements

- Functional:
  - `vercel.json` builds `packages/web` (already output to `../cli/dist/web` in Phase 5; configure Vercel `outputDirectory` accordingly) as static + `api/[...path].ts` as the function, sharing origin, with CSP/security headers and `functions.maxDuration`.
  - "Deploy to Vercel" button (deep-link with repo URL) → a working self-hosted instance, **paste-only by default** (no server token). Empirically confirm a fresh self-host works with a pasted PAT.
  - Self-host security docs (F2): server-side `GITHUB_TOKEN` is honored only on loopback; a public Vercel self-host with an env token refuses to start unless `REPOREAPER_ACCESS_PASSWORD` is set; recommend Vercel Deployment Protection. State plainly that a hosted instance means trusting whoever operates it.
  - README: what it does, quickstart (`npx reporeaper`), local `reporeaper ui`, token guide, self-host (with the security model), restore caveat.
- Non-functional: docs for the skeptical reader; the source is linkable but the security story does not rest on "read the source" of an instance you don't control (F12 — no operator instance means the honest framing is "run it yourself").

## Architecture

Self-host topology: user's own `their-fork.vercel.app` → static SPA + `/api/*` function. No env vars required (paste-only). If an operator opts into an env token, it is gated by loopback OR access password. No project-run shared instance exists, so there is no operator log-drain surface to attest — but the self-hosting doc includes a "don't add log drains / observability integrations that capture requests" checklist for anyone who does host publicly (F12).

## Related Code Files

- Create: `README.md`, `docs/token-guide.md` (fine-grained PAT walkthrough — Administration permission **verified in step 1**, or classic `delete_repo`+`repo`; recommend "All repositories" for the listing flow with the trade-off explained (F9); recommend short-expiry tokens), `docs/self-hosting.md` (security model + rollback), `LICENSE` (MIT)
- Modify: `vercel.json` (finalize), root `package.json` metadata

## Implementation Steps

1. **Empirically verify the delete permission (F9):** create a throwaway repo; with an `Administration: write`-only fine-grained PAT, attempt archive+delete; record what actually works. Core's error strings and the token guide must match this result (feeds back to Phase 2's error copy).
2. Finalize `vercel.json`; do a **preview** self-host deploy; verify paste-only token gate + archive/delete on a throwaway repo.
3. Deploy-to-Vercel button + `docs/self-hosting.md` incl. the env-token loopback/password rule, Deployment Protection guidance, no-log-drain checklist, and a rollback note (pin production alias to a known-good deployment; how to take an instance down).
4. Write `docs/token-guide.md` from the step-1 measured permissions.
5. README with the honest run-model framing (local/npx primary; self-host = your own instance and your own trust).

## Success Criteria

- [ ] Delete permission for fine-grained PATs empirically confirmed; docs + core error strings match the measurement
- [ ] Fresh self-host from the button works paste-only with no configuration
- [ ] `docs/self-hosting.md` states the loopback/password rule and includes rollback + no-log-drain checklist
- [ ] A new user can create a correctly-scoped PAT using only `docs/token-guide.md`
- [ ] README leads with `npx`/local; self-host framed honestly (no claims about an instance the project doesn't run)

## Risk Assessment

Low technical, high trust. Risk: token guide drifts as GitHub renames permission UI (signal: "I can't find this setting" issues) → docs patch; keep screenshots name-based/minimal. The self-host security rules (loopback-only env token, password gate) are enforced in Phase 3 code, not just prose, so a careless self-hoster cannot trivially stand up an open delete endpoint.
