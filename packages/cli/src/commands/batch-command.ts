import {
  filterRepos,
  GitHubProvider,
  sanitizeDisplay,
  type Repo,
  type RepoAction,
} from '@reporeaper/core';
import { describeResult, runBatch } from '../batch-runner.js';
import { resolveToken } from '../token.js';

/**
 * The scriptable half of the CLI: `reporeaper delete <pattern> --yes`.
 *
 * Interactive confirmation is impossible here, so `--yes` is mandatory rather
 * than convenient — running a destructive batch because someone forgot a flag
 * is not a recoverable mistake.
 */

export interface BatchCommandOptions {
  yes?: boolean;
  /** Print what would happen and exit without touching anything. */
  dryRun?: boolean;
}

/** Writes a line to stdout. The CLI is expected to speak. */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function printError(line: string): void {
  process.stderr.write(`${line}\n`);
}

/** Warns when a deletion is not recoverable through GitHub support. */
function restorabilityNote(repo: Repo): string {
  return repo.fork || repo.forksCount > 0 ? ' (fork network — not restorable)' : '';
}

/**
 * Runs a non-interactive batch and returns the process exit code.
 *
 * Returns rather than exits so tests can drive it without killing the runner.
 */
export async function runBatchCommand(
  action: RepoAction,
  pattern: string,
  options: BatchCommandOptions,
): Promise<number> {
  const token = await resolveToken();
  const provider = new GitHubProvider(token);

  const viewer = await provider.getViewer();
  const listing = await provider.listAllRepos();
  const matched = filterRepos(listing.repos, pattern);

  if (listing.visibility.partial) {
    printError(
      `Warning: this token sees ${listing.visibility.seen} of ${listing.visibility.accountTotal} ` +
        'repositories on the account. Repositories it cannot see are not listed below.',
    );
  }

  if (matched.length === 0) {
    print(`No repositories match "${sanitizeDisplay(pattern)}".`);
    return 0;
  }

  print(`${matched.length} repositor${matched.length === 1 ? 'y' : 'ies'} match:`);
  for (const repo of matched) {
    const blocked = repo.permissions.admin ? '' : ' [no admin rights — will fail]';
    print(`  ${repo.name}  #${repo.id}${restorabilityNote(repo)}${blocked}`);
  }

  if (options.dryRun) {
    print('\nDry run: nothing was changed.');
    return 0;
  }

  if (!options.yes) {
    printError(
      `\nRefusing to ${action} ${matched.length} repositories without confirmation. ` +
        'Re-run with --yes, or use the interactive TUI (`reporeaper`).',
    );
    return 2;
  }

  print(`\n${action === 'delete' ? 'Deleting' : 'Archiving'}...`);

  const summary = await runBatch(provider, matched, action, {
    authenticatedLogin: viewer.login,
    onResult: (result) => {
      print(`  ${result.ok ? '✓' : '✗'} ${describeResult(result)}`);
    },
  });

  print(`\n${summary.succeeded.length} succeeded, ${summary.failed.length} failed.`);
  if (summary.failed.length > 0) {
    print('Retry the remainder with the same command; repositories already gone are skipped.');
    return 1;
  }
  return 0;
}
