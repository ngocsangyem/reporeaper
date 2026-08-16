# RepoReaper

Batch archive or delete your personal GitHub repositories — from a terminal UI,
a scriptable CLI, or a local web UI.

```sh
npx reporeaper
```

That opens the terminal UI: every repository you own, instant search,
multi-select, then archive or delete with a confirmation you have to mean.

It only ever touches **remote GitHub repositories you own**. Nothing on your
disk, nothing in an organization.

## Why it exists

GitHub's own UI makes you visit each repository, scroll to the danger zone, and
retype its full name. That is a sensible design for deleting one repository and
an unusable one for deleting thirty.

The interesting part of the problem is not the loop, it is not deleting the
wrong thing:

- **Selection is keyed by repository id, never by row position.** Filter, select,
  filter again — the selection follows the repositories you chose, not the rows
  they used to occupy.
- **Every action re-reads the repository and checks its id before mutating.**
  GitHub names are reusable. Between listing and confirming, a name can come to
  mean a different repository; that one is refused rather than deleted.
- **One repository per request, paced.** Interrupt a batch at any point and the
  report shows exactly what completed.
- **Fork networks are called out.** GitHub can usually restore a deleted
  repository within 90 days — but not one in a fork network. The confirmation
  says so when it applies rather than reassuring you in general.

## Three ways to run it

### Terminal UI

```sh
npx reporeaper
```

Type to search · `↑↓` to move · `space` to select · `tab` to switch between
archive and delete · `enter` to continue. The confirmation asks you to type the
number of selected repositories.

### Scripts and CI

```sh
reporeaper archive "2019-" --yes
reporeaper delete "experiment-" --dry-run   # show what would go, change nothing
reporeaper delete "experiment-" --yes
```

`<pattern>` is a case-insensitive substring matched against names and
descriptions — not a glob, not a regex, and not fuzzy. Exits `1` if any
repository failed so a pipeline notices.

Without a terminal, the bare command explains itself and exits `2` instead of
crashing.

### Local web UI

```sh
reporeaper ui
```

Serves the same interface on `127.0.0.1` with a per-process session token in the
URL. The token comes from your environment or `.env`; nothing leaves your
machine. Loopback only — not your local network.

## The token

`GITHUB_TOKEN`, then `GH_TOKEN`, then a hidden prompt. Never written to disk,
never logged.

A fine-grained token needs **Administration: read and write** to delete or
archive. See [docs/token-guide.md](docs/token-guide.md) for the walkthrough, the
"all repositories" trade-off, and a two-minute checklist to confirm what your
token can actually do.

```sh
export GITHUB_TOKEN=github_pat_…
# or, for `reporeaper ui`:
cp .env.example .env
```

## Self-hosting the web UI

There is **no public instance**, and this project will not run one — a hosted
tool that deletes repositories is a credential-collection service with a
friendly face. You can deploy your own, paste-only by default, with no
environment variables:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ngocsangyem/reporeaper)

Read [docs/self-hosting.md](docs/self-hosting.md) first. It states what an
operator can see, why an ambient `GITHUB_TOKEN` on a public URL is refused
outright, and how to take an instance down.

## What it will not do

- Touch organization repositories (v1 is personal repositories only)
- Touch anything on your disk
- Store your token anywhere, in any mode
- Sort the table or show stars — more ways to reorder rows is more ways for a
  selection to end up somewhere you did not look
- Use GitHub's search API — its index lags, and it will happily return
  repositories that were deleted minutes ago

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint && pnpm typecheck
pnpm hygiene          # sentinel test: no token reaches any output path
pnpm verify:tarball   # the published package installs and runs standalone
```

Node 20.19+ (22 recommended). `packages/core` holds the GitHub client, the
actions, and the RPC proxy; `packages/cli` is the published binary;
`packages/web` builds into it.

## Licence

MIT
