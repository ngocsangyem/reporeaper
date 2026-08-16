import {
  filterRepos,
  type ActionResult,
  type Repo,
  type RepoAction,
  type RepoListing,
} from '@reporeaper/core';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { runBatch } from './batch/run-batch.js';
import { BatchReport } from './screens/batch-report.js';
import { ConfirmDialog } from './screens/confirm-dialog.js';
import { RepoTable } from './screens/repo-table.js';
import { TokenGate } from './screens/token-gate.js';
import { SessionProvider, useSession } from './state/session.js';

/**
 * App shell: command bar → table → sticky action bar → dialog → report.
 *
 * Selection is a Set of repository ids and is never derived from row position.
 * Filtering reorders and hides rows; anything index-based would silently
 * retarget the selection as the user types.
 */

type View = 'list' | 'running' | 'report';

function Workspace(): React.JSX.Element {
  const { client, me, refresh } = useSession();

  const [listing, setListing] = useState<RepoListing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [action, setAction] = useState<RepoAction>('archive');
  const [confirming, setConfirming] = useState(false);
  const [view, setView] = useState<View>('list');
  const [results, setResults] = useState<ActionResult[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const loaded = await client.listRepos();
        if (!cancelled) {
          setListing(loaded);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : 'Could not load repositories.');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client]);

  const visible = useMemo(
    () => (listing === null ? [] : filterRepos(listing.repos, query)),
    [listing, query],
  );

  // Resolved from the full list, not the filtered view: a repository stays
  // selected while hidden, and the confirm step must show all of it.
  const selectedRepos = useMemo(
    () => (listing === null ? [] : listing.repos.filter((repo) => selectedIds.has(repo.id))),
    [listing, selectedIds],
  );

  const toggle = useCallback((id: number) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Select-all applies to what is currently filtered, and only what is actionable. */
  const toggleAll = useCallback(() => {
    const actionable = visible.filter((repo) => repo.permissions.admin).map((repo) => repo.id);
    setSelectedIds((previous) => {
      const everySelected = actionable.every((id) => previous.has(id));
      const next = new Set(previous);
      for (const id of actionable) {
        if (everySelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [visible]);

  const start = useCallback(
    async (repos: Repo[]) => {
      setConfirming(false);
      setResults([]);
      setBatchTotal(repos.length);
      setView('running');

      const outcome = await runBatch(client, repos, action, {
        onResult: (result) => setResults((previous) => [...previous, result]),
      });

      setSelectedIds(new Set(outcome.remaining.map((repo) => repo.id)));
      setView('report');
    },
    [action, client],
  );

  if (loadError !== null) {
    return (
      <main className="mx-auto w-full max-w-[70rem] px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] text-[var(--color-danger)]">
          Could not load your repositories.
        </h1>
        <p className="mt-2 max-w-[60ch] text-[var(--color-ink-dim)]">{loadError}</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-6 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink)] hover:border-[var(--color-accent)]"
        >
          Try again
        </button>
      </main>
    );
  }

  if (listing === null) {
    return (
      <main className="mx-auto w-full max-w-[70rem] px-6 py-16">
        <p className="font-[family-name:var(--font-display)] text-[var(--color-ink-faint)]">
          Reading your repositories…
        </p>
      </main>
    );
  }

  if (view === 'running' || view === 'report') {
    return (
      <main className="mx-auto w-full max-w-[70rem] px-6 py-10">
        <BatchReport
          results={results}
          total={batchTotal}
          running={view === 'running'}
          onRetry={() => void start(selectedRepos)}
          onDone={() => {
            setView('list');
            void (async () => {
              try {
                setListing(await client.listRepos());
              } catch (error) {
                // A failed reload must not leave deleted repositories on screen
                // looking like they still exist.
                setListing(null);
                setLoadError(
                  error instanceof Error ? error.message : 'Could not reload repositories.',
                );
              }
            })();
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[70rem] px-6 pt-8 pb-28">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xs)] tracking-[0.2em] text-[var(--color-accent)] uppercase">
          reporeaper
        </span>
        {me?.login ? (
          <span className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
            {me.login}
            {me.tokenType ? ` · ${me.tokenType} token` : ''}
          </span>
        ) : null}
        <span
          data-numeric
          className="ml-auto font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink-faint)]"
        >
          {listing.repos.length} repositories
        </span>
      </header>

      <div className="mt-6">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by name or description"
          aria-label="Filter repositories"
          className="w-full rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-paper-2)] px-3 py-2.5 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]"
        />
      </div>

      <div className="mt-6">
        <RepoTable
          repos={visible}
          selectedIds={selectedIds}
          onToggle={toggle}
          onToggleAll={toggleAll}
          visibility={listing.visibility}
        />
      </div>

      {selectedRepos.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-[10] border-t border-[var(--color-rule-strong)] bg-[var(--color-paper-2)]">
          <div className="mx-auto flex w-full max-w-[70rem] flex-wrap items-center gap-3 px-6 py-3">
            <span
              data-numeric
              className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink)]"
            >
              {selectedRepos.length} selected
            </span>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[length:var(--text-sm)] text-[var(--color-ink-faint)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:text-[var(--color-ink)]"
            >
              Clear
            </button>

            <div className="ml-auto flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setAction('archive');
                  setConfirming(true);
                }}
                className="rounded-[var(--radius-sm)] border border-[var(--color-caution)] px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap text-[var(--color-caution)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:bg-[var(--color-caution)] hover:text-[var(--color-paper)]"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={() => {
                  setAction('delete');
                  setConfirming(true);
                }}
                className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap text-[var(--color-danger)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:bg-[var(--color-danger)] hover:text-[var(--color-paper)]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        action={action}
        repos={selectedRepos}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void start(selectedRepos)}
      />
    </main>
  );
}

/** Chooses between the gate and the workspace once mode detection resolves. */
function Root(): React.JSX.Element {
  const { status, refresh } = useSession();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (status === 'checking') {
    return (
      <main className="mx-auto w-full max-w-[70rem] px-6 py-16">
        <p className="font-[family-name:var(--font-display)] text-[var(--color-ink-faint)]">
          Connecting…
        </p>
      </main>
    );
  }

  return status === 'needs-token' ? <TokenGate /> : <Workspace />;
}

export function App({ baseUrl }: { baseUrl?: string }): React.JSX.Element {
  return (
    <SessionProvider {...(baseUrl === undefined ? {} : { baseUrl })}>
      <Root />
    </SessionProvider>
  );
}
