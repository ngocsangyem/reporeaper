import type { ActionResult, Repo, RepoAction } from '@reporeaper/core';
import type { ApiClient } from '../api/client.js';

/**
 * The batch loop, driven by the browser.
 *
 * One repository per request. The server never receives a list, so it can never
 * be halfway through one: if the tab closes, the network drops, or the user
 * walks away, the results already rendered are exactly the work that completed.
 */

const PACE_MS = 1000;
const RATE_LIMIT_BACKOFF_MS = 60_000;

export interface RunBatchOptions {
  onResult: (result: ActionResult) => void;
  /** Lets a caller stop between repositories. */
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export interface BatchOutcome {
  results: ActionResult[];
  /** Repositories that did not succeed, ready for a retry pass. */
  remaining: Repo[];
  stopped: boolean;
}

export async function runBatch(
  client: ApiClient,
  repos: Repo[],
  action: RepoAction,
  options: RunBatchOptions,
): Promise<BatchOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const results: ActionResult[] = [];
  let stopped = false;

  for (const [index, repo] of repos.entries()) {
    if (options.shouldStop?.()) {
      stopped = true;
      break;
    }

    // Mutations are paced: GitHub's secondary rate limit is triggered by rapid
    // successive writes, well inside the documented hourly quota.
    if (index > 0) await sleep(PACE_MS);

    let result = await actOnce(client, action, repo);

    if (result.code === 'secondary-rate-limit' || result.code === 'primary-rate-limit') {
      await sleep(RATE_LIMIT_BACKOFF_MS);
      result = await actOnce(client, action, repo);
    }

    results.push(result);
    options.onResult(result);
  }

  const failedIds = new Set(results.filter((result) => !result.ok).map((result) => result.repo.id));

  return {
    results,
    remaining: repos.filter((repo) => failedIds.has(repo.id)),
    stopped,
  };
}

/**
 * A network failure has to become a result, not an exception: one unreachable
 * request must not abandon the remaining repositories or lose the record of
 * what already happened.
 */
async function actOnce(client: ApiClient, action: RepoAction, repo: Repo): Promise<ActionResult> {
  try {
    return await client.act(action, { id: repo.id, owner: repo.owner.login, name: repo.name });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request failed.';
    return {
      repo: { id: repo.id, owner: repo.owner.login, name: repo.name },
      action,
      ok: false,
      outcome: 'failed',
      code: 'request-failed',
      error: message,
    };
  }
}
