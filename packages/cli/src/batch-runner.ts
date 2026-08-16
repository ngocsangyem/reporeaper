import {
  DEFAULT_PACE_MS,
  pace,
  runAction,
  sanitizeDisplay,
  toRepoRef,
  type ActionResult,
  type Provider,
  type Repo,
  type RepoAction,
} from '@reporeaper/core';

/**
 * Client-driven batch execution.
 *
 * The loop lives here, in the client, rather than behind a single server call.
 * That is what makes an interrupted run recoverable: after every repository the
 * caller knows exactly what completed, so a crash, a Ctrl-C, or a closed laptop
 * leaves an accurate record instead of an unknown partial state.
 */

export interface BatchOptions {
  /** Login of the authenticated account; every action re-verifies against it. */
  authenticatedLogin: string;
  /** Called after each repository so a UI can render progress as it happens. */
  onResult?: (result: ActionResult, index: number, total: number) => void;
  /** Minimum gap between mutations. */
  paceMs?: number;
  /** Injectable for tests so a paced batch does not sleep in real time. */
  sleep?: (ms: number) => Promise<void>;
}

export interface BatchSummary {
  results: ActionResult[];
  succeeded: ActionResult[];
  failed: ActionResult[];
  /** Repositories worth retrying: everything that did not succeed. */
  remaining: Repo[];
}

/** Seconds to wait when GitHub says to slow down, defaulting to a minute. */
function backoffMsFor(result: ActionResult): number | null {
  if (result.code !== 'secondary-rate-limit' && result.code !== 'primary-rate-limit') return null;
  return 60_000;
}

/**
 * Runs one action across many repositories, sequentially.
 *
 * Sequential is deliberate: GitHub's secondary rate limit punishes concurrent
 * and rapid mutations, and being fast here buys nothing a user cares about.
 */
export async function runBatch(
  provider: Provider,
  repos: Repo[],
  action: RepoAction,
  options: BatchOptions,
): Promise<BatchSummary> {
  const paceMs = options.paceMs ?? DEFAULT_PACE_MS;
  const sleep = options.sleep ?? pace;
  const results: ActionResult[] = [];

  for (const [index, repo] of repos.entries()) {
    if (index > 0) await sleep(paceMs);

    let result = await runAction(provider, toRepoRef(repo), action, {
      authenticatedLogin: options.authenticatedLogin,
    });

    // One retry after a rate-limit backoff. A repeated limit means the account
    // is genuinely throttled, and hammering it further only extends the block.
    const backoff = backoffMsFor(result);
    if (backoff !== null) {
      await sleep(backoff);
      result = await runAction(provider, toRepoRef(repo), action, {
        authenticatedLogin: options.authenticatedLogin,
      });
    }

    results.push(result);
    options.onResult?.(result, index, repos.length);
  }

  const succeeded = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const failedIds = new Set(failed.map((result) => result.repo.id));

  return {
    results,
    succeeded,
    failed,
    remaining: repos.filter((repo) => failedIds.has(repo.id)),
  };
}

/** One-line rendering of a result, for both the TUI report and the CLI output. */
export function describeResult(result: ActionResult): string {
  // Sanitized here too: this line is printed to a terminal, and the name is
  // provider-supplied text.
  const name = sanitizeDisplay(result.repo.name, 60);
  switch (result.outcome) {
    case 'ok':
      return `${name}: ${result.action === 'delete' ? 'deleted' : 'archived'}`;
    case 'already-gone':
      return `${name}: already gone`;
    case 'changed-since-listing':
      return `${name}: skipped — ${result.error ?? 'changed since it was listed'}`;
    default:
      return `${name}: failed — ${result.error ?? 'unknown error'}`;
  }
}
