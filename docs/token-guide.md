# Creating a token for RepoReaper

RepoReaper needs a GitHub personal access token. It never stores one: the CLI
reads it from the environment or prompts for it, and the web UI keeps a pasted
token in the tab's memory only.

Use a **short expiry**. Thirty days is plenty for a cleanup, and a token that
can delete repositories should not outlive the job it was made for.

> **Verification status.** The permissions below are taken from GitHub's REST
> documentation, not from a run against a live account. Before trusting them in
> anger, spend two minutes on the measurement checklist at the bottom — it takes
> one throwaway repository and tells you exactly what your token can do.

## Fine-grained token (recommended)

<https://github.com/settings/personal-access-tokens/new>

| Setting              | Value                                                        |
| -------------------- | ------------------------------------------------------------ |
| Resource owner       | Your own account                                              |
| Repository access    | **All repositories** (see the trade-off below)                |
| Expiration           | The shortest that covers your session                         |
| Metadata             | Read-only — granted automatically, needed to list anything    |
| Administration       | **Read and write** — required to delete, and to archive       |

`Administration: write` is the permission that matters. GitHub's documentation
lists it for both `DELETE /repos/{owner}/{repo}` (delete) and
`PATCH /repos/{owner}/{repo}` (archive). Without it you can browse the list and
every action will fail at the moment you confirm.

### The "All repositories" trade-off

A fine-grained token scoped to *selected* repositories still returns a
perfectly normal-looking list — just a shorter one. Nothing in the response says
"there are forty more you cannot see."

RepoReaper compares what your token returned against the repository count on
your account and shows a banner when they disagree:

> This token can see 5 of 40 repositories on the account.

If you scope the token to selected repositories, expect that banner and treat
the list as partial. If you want the full picture, grant **All repositories** —
you are the resource owner either way, and the token still cannot touch
anything you do not own.

### Repositories you cannot delete

Rows without admin rights are shown but not selectable, marked `no admin`. This
is deliberate: discovering after the confirmation that a third of the batch was
never permitted is a worse experience than seeing it beforehand.

## Classic token

<https://github.com/settings/tokens/new>

| Scope         | Why                                   |
| ------------- | ------------------------------------- |
| `repo`        | List repositories, including private  |
| `delete_repo` | Delete. GitHub requires it explicitly |

Classic tokens are coarse — `repo` grants read and write across everything you
can reach. Prefer fine-grained unless you have a reason not to.

## Measurement checklist

Two minutes, one throwaway repository, and you know instead of assume:

1. Create a repository you do not care about, e.g. `reaper-test`.
2. Create a fine-grained token with **Administration: read and write**.
3. Check what the token sees and what it can do:

   ```sh
   export GITHUB_TOKEN=…              # your new token

   # Listing works?
   reporeaper archive reaper-test --dry-run

   # Archive works? (reversible — unarchive afterwards in the GitHub UI)
   reporeaper archive reaper-test --yes

   # Delete works?
   reporeaper delete reaper-test --yes
   ```

4. If any step fails with a permission error, the message names what GitHub
   refused. Adjust the token and note the difference — and please open an issue
   so this guide can be corrected.

## Troubleshooting

**"GitHub rejected the token."** Expired, revoked, or copied with a character
missing. Tokens are shown once; regenerate rather than guess.

**Every action fails with a permission error.** The token authenticated but
lacks `Administration: write` (fine-grained) or `delete_repo` (classic).

**A repository you expected is missing.** The token is scoped to a subset. Check
the banner at the top of the list.

**"GitHub secondary rate limit hit."** You are writing too fast for GitHub's
liking. RepoReaper already paces mutations a second apart and backs off when
this happens; nothing was lost, and re-running skips whatever already completed.
