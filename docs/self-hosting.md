# Self-hosting RepoReaper

**There is no public RepoReaper instance.** Nobody operates one for you, and
this project will not run one. A hosted tool that deletes repositories is a
credential-collection service with a friendly face; the only version of that
you should trust is the one you run yourself.

If you only want to clean up your own account, you do not need this page. Use:

```sh
npx reporeaper            # terminal UI
reporeaper ui             # the same web UI, on 127.0.0.1, from your own machine
```

Both keep the token on your machine. Self-hosting is for the case where you
specifically want the web UI on a URL — for a colleague, or on a device where
you would rather not install Node.

## Deploying your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ngocsangyem/reporeaper)

> That link points at this repository. If you publish your own fork, swap the
> owner so the button deploys your copy rather than someone else's.

The default deployment needs **no environment variables**. It is paste-only:
each visitor supplies their own token, it lives in their tab, and the server
stores nothing.

## The security model, stated plainly

**Whoever operates an instance can see what passes through it.** That is true of
this software and every other web tool of its kind. A server that receives your
token in a request header is, at that moment, capable of using it. The mitigation
is not a promise in a README — it is that you are the operator.

What the code guarantees regardless of the operator:

| Rule | Enforcement |
| --- | --- |
| A pasted token is never written to disk, a cookie, or storage | It lives in a private field in one React provider |
| A server-side `GITHUB_TOKEN` is honored **only** on a loopback listener | `isLoopback` gate in the proxy |
| A public instance holding a `GITHUB_TOKEN` refuses to serve | Returns 503 until `REPOREAPER_ACCESS_PASSWORD` is set |
| No request, header, or body is ever logged | Scoped lint rule plus a runtime sentinel test in CI |
| The proxy exposes three named operations, not GitHub | `/api/me`, `/api/repos`, `/api/actions` — no path passthrough |

### Why an ambient token on a public URL is refused

Set `GITHUB_TOKEN` on a public deployment and every visitor acts as you. They do
not need to authenticate; they just need the URL. The proxy therefore refuses to
serve at all in that configuration:

```json
{ "error": "unsafe_configuration" }
```

To run an instance with an ambient token deliberately — a private one, for
yourself — set `REPOREAPER_ACCESS_PASSWORD` as well. Every request must then
carry `x-access-password`. Prefer Vercel's Deployment Protection on top of that.

### If you host publicly, do not add request-capturing integrations

A log drain that captures headers turns a careful design into a token archive.
Before you point anyone at your instance:

- [ ] No log drain configured that records request headers or bodies
- [ ] No APM, error reporter, or session-replay tool with request capture
- [ ] No reverse proxy or WAF in front that logs full requests
- [ ] `REPOREAPER_ACCESS_PASSWORD` set, or no server-side token at all
- [ ] Deployment Protection enabled if the audience is just you
- [ ] The deployment is on your own account, not a shared team project

## Taking an instance down

Deletion cannot be undone, so the useful rollback is about the *instance*, not
the repositories.

**Roll back a bad deployment.** In Vercel, open the project's Deployments tab,
find a known-good build, and promote it to production. Traffic moves as soon as
the alias updates.

**Take it offline entirely.** Delete the production alias, or delete the
project. Any token that was pasted into a browser tab dies with the tab; there is
no server-side copy to purge.

**If you suspect a token was exposed**, revoke it at
<https://github.com/settings/tokens> — immediately and before anything else.
Revocation is the only control that is fully in your hands.

## What this cannot protect you from

- A malicious operator of an instance you do not control. Run your own.
- A token with more scope than the job needed. Use short expiries and
  fine-grained tokens; see [the token guide](./token-guide.md).
- Deleting the wrong thing on purpose. Every action re-verifies the repository
  id before it mutates, so the tool will not hit a *different* repository than
  the one you selected — but it will faithfully delete the one you did.
