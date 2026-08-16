import { NotFoundError, ProviderError } from './errors.js';
import type { Provider } from './provider.js';
import { sanitizeDisplay } from './sanitize.js';
import type { ActionResult, Repo, RepoAction, RepoRef } from './types.js';

/**
 * Minimum gap between mutations.
 *
 * GitHub's secondary rate limit punishes rapid successive writes, and it is not
 * the documented hourly quota — it triggers well inside it. One second is the
 * conservative floor; the caller can raise it after a secondary-limit error.
 */
export const DEFAULT_PACE_MS = 1000;

/** Resolves after `ms`, used by callers driving a batch loop. */
export function pace(ms: number = DEFAULT_PACE_MS): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface RunActionOptions {
  /** Login of the authenticated user; the action refuses to touch anyone else's repo. */
  authenticatedLogin: string;
}

/**
 * Confirms the live repository is still the one the user selected.
 *
 * Names are reusable on GitHub. Between listing and acting, a repo can be
 * renamed or deleted and a different one can take its name — so acting on a
 * name alone can destroy something the user never saw. Identity is the numeric
 * id; the name is only an address.
 */
function describeMismatch(
  selected: RepoRef,
  live: Repo,
  authenticatedLogin: string,
): string | null {
  if (live.id !== selected.id) {
    return `"${selected.name}" now refers to a different repository than the one selected.`;
  }
  if (live.owner.type !== 'User') {
    return `"${selected.name}" is owned by an organization; this tool only acts on personal repositories.`;
  }
  if (live.owner.login !== authenticatedLogin) {
    return `"${selected.name}" is not owned by the authenticated account.`;
  }
  return null;
}

/**
 * Performs one action on one repository, verifying identity first.
 *
 * One repository per call is deliberate: the caller drives the loop, so it
 * always knows exactly which items completed. A whole-batch call that dies
 * halfway leaves the user with no record of what happened.
 *
 * Never throws for an expected failure — the result carries the outcome so a
 * batch loop can continue and report precisely.
 */
export async function runAction(
  provider: Provider,
  repo: RepoRef,
  action: RepoAction,
  options: RunActionOptions,
): Promise<ActionResult> {
  const base = { repo, action } as const;

  try {
    const live = await provider.getRepo(repo.owner, repo.name);

    if (live === null) {
      // A 404 here is ambiguous and must not be read as success. It means
      // either the repository is already deleted, or this token can no longer
      // see it — GitHub returns 404 for both, deliberately, so that a token
      // cannot probe for the existence of private repositories.
      //
      // Claiming "deleted" would be the one lie this tool must never tell: the
      // user would close the terminal believing a repository is gone while it
      // still exists. Nothing was verified and nothing was attempted, so this
      // is reported as unresolved and stays in the retry set.
      return {
        ...base,
        ok: false,
        outcome: 'failed',
        code: 'not-visible',
        error:
          `"${sanitizeDisplay(repo.name)}" was not found. It may already be deleted, ` +
          'or this token may no longer have access to it — GitHub reports both the same way.',
      };
    }

    const mismatch = describeMismatch(repo, live, options.authenticatedLogin);
    if (mismatch !== null) {
      return {
        ...base,
        ok: false,
        outcome: 'changed-since-listing',
        code: 'changed-since-listing',
        error: sanitizeDisplay(mismatch),
      };
    }

    if (action === 'delete') {
      await provider.deleteRepo(live.owner.login, live.name);
    } else {
      await provider.archiveRepo(live.owner.login, live.name);
    }

    return { ...base, ok: true, outcome: 'ok' };
  } catch (error) {
    // A 404 at the mutation step is a different situation from a 404 at the
    // pre-check: a GET succeeded moments ago and confirmed this exact id, so
    // the repository existed and was visible. Something removed it in between,
    // and the overwhelmingly likely something is our own delete whose response
    // was lost. This one is safe to count as done.
    if (error instanceof NotFoundError && action === 'delete') {
      return { ...base, ok: true, outcome: 'already-gone' };
    }
    if (error instanceof ProviderError) {
      return {
        ...base,
        ok: false,
        outcome: 'failed',
        code: error.code,
        error: sanitizeDisplay(error.message),
      };
    }
    return {
      ...base,
      ok: false,
      outcome: 'failed',
      code: 'unknown',
      error: sanitizeDisplay(error instanceof Error ? error.message : 'Unknown error'),
    };
  }
}
