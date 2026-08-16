import {
  filterRepos,
  sanitizeDisplay,
  type ActionResult,
  type Provider,
  type Repo,
  type RepoAction,
  type RepoListing,
} from '@reporeaper/core';
import { Box, Text, useApp, useInput } from 'ink';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runBatch } from '../batch-runner.js';
import { Confirm } from './confirm.js';
import { Report } from './report.js';
import { RepoList } from './repo-list.js';

/**
 * The TUI state machine: loading → list → confirm → running → report.
 *
 * Selection is a Set of repository ids, never indices. Filtering changes which
 * rows exist and in what order, so an index-based selection would quietly point
 * at different repositories after every keystroke — the single most dangerous
 * bug this UI could have.
 */

type Screen = 'loading' | 'list' | 'confirm' | 'running' | 'report' | 'error';

export interface AppProps {
  provider: Provider;
  /** Injected so tests can drive the batch without real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Lets the caller exit non-zero when the session ended in failure. */
  onFatalError?: (message: string) => void;
}

export function App({ provider, sleep, onFatalError }: AppProps): React.JSX.Element {
  const { exit } = useApp();

  const [screen, setScreen] = useState<Screen>('loading');
  const [listing, setListing] = useState<RepoListing | null>(null);
  const [login, setLogin] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  /**
   * Keystrokes can arrive several at a time in one chunk (a paste, or simply
   * typing fast), and React state does not update between them. Reading the
   * cursor or the query from state inside the handler would act on values from
   * before the previous keystroke — which once made a space toggle the wrong
   * repository. These refs hold the input model as of the current keystroke;
   * state exists only to trigger a render.
   */
  const cursorRef = useRef(0);
  const queryRef = useRef('');

  const applyQuery = useCallback((next: string) => {
    queryRef.current = next;
    cursorRef.current = 0;
    setQuery(next);
    setCursor(0);
  }, []);

  const applyCursor = useCallback((next: number) => {
    cursorRef.current = next;
    setCursor(next);
  }, []);

  const [action, setAction] = useState<RepoAction>('archive');
  const [typed, setTyped] = useState('');
  /** Same reason as the cursor and query refs: "2" then Enter can arrive together. */
  const typedRef = useRef('');

  const applyTyped = useCallback((next: string) => {
    typedRef.current = next;
    setTyped(next);
  }, []);
  const [confirmError, setConfirmError] = useState<string | undefined>(undefined);

  const [results, setResults] = useState<ActionResult[]>([]);
  const [batchTotal, setBatchTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [viewer, loaded] = await Promise.all([provider.getViewer(), provider.listAllRepos()]);
        if (cancelled) return;
        setLogin(viewer.login);
        setListing(loaded);
        setScreen('list');
      } catch (error) {
        if (cancelled) return;
        const message = sanitizeDisplay(
          error instanceof Error ? error.message : 'Unknown error',
          200,
        );
        setFailure(message);
        onFatalError?.(message);
        setScreen('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, onFatalError]);

  const visible = useMemo(
    () => (listing === null ? [] : filterRepos(listing.repos, query)),
    [listing, query],
  );

  /**
   * Resolves selected ids back to repositories from the full list, not the
   * filtered view — a repository stays selected even after a filter hides it,
   * and the confirm screen must show everything that is about to be acted on.
   */
  const selectedRepos = useMemo(
    () => (listing === null ? [] : listing.repos.filter((repo) => selectedIds.has(repo.id))),
    [listing, selectedIds],
  );

  const startBatch = useCallback(
    async (repos: Repo[], chosen: RepoAction) => {
      setResults([]);
      setBatchTotal(repos.length);
      setScreen('running');

      const summary = await runBatch(provider, repos, chosen, {
        authenticatedLogin: login,
        sleep,
        onResult: (result) => {
          setResults((previous) => [...previous, result]);
        },
      });

      // Successful repositories are gone; leaving them selected would invite a
      // pointless second pass.
      const failedIds = new Set(summary.failed.map((result) => result.repo.id));
      setSelectedIds(failedIds);
      setScreen('report');
    },
    [login, provider, sleep],
  );

  useInput((input, key) => {
    if (screen === 'error') {
      exit();
      return;
    }

    if (screen === 'report') {
      if (input === 'q') exit();
      if (input === 'r' && selectedRepos.length > 0) void startBatch(selectedRepos, action);
      return;
    }

    if (screen === 'running') return;

    if (screen === 'confirm') {
      if (key.escape) {
        applyTyped('');
        setConfirmError(undefined);
        setScreen('list');
        return;
      }
      if (key.return) {
        if (typedRef.current === String(selectedRepos.length)) {
          void startBatch(selectedRepos, action);
        } else {
          setConfirmError(`Type ${selectedRepos.length} exactly to proceed.`);
          applyTyped('');
        }
        return;
      }
      if (key.backspace || key.delete) {
        applyTyped(typedRef.current.slice(0, -1));
        return;
      }
      if (/^[0-9]+$/.test(input)) applyTyped(typedRef.current + input);
      return;
    }

    // List screen. Everything below reads the refs, never the render state.
    const rows = listing === null ? [] : filterRepos(listing.repos, queryRef.current);

    if (key.escape || (key.ctrl && input === 'c')) {
      exit();
      return;
    }
    if (key.upArrow) {
      applyCursor(Math.max(0, cursorRef.current - 1));
      return;
    }
    if (key.downArrow) {
      applyCursor(Math.min(Math.max(0, rows.length - 1), cursorRef.current + 1));
      return;
    }
    if (input === ' ') {
      const repo = rows[cursorRef.current];
      if (repo) {
        setSelectedIds((previous) => {
          const next = new Set(previous);
          if (next.has(repo.id)) next.delete(repo.id);
          else next.add(repo.id);
          return next;
        });
      }
      return;
    }
    if (key.tab) {
      setAction((previous) => (previous === 'delete' ? 'archive' : 'delete'));
      return;
    }
    if (key.return) {
      if (selectedRepos.length > 0) {
        applyTyped('');
        setConfirmError(undefined);
        setScreen('confirm');
      }
      return;
    }
    if (key.backspace || key.delete) {
      applyQuery(queryRef.current.slice(0, -1));
      return;
    }
    // Printable input extends the search. Terminals deliver a pasted string as
    // a single chunk, so this must not assume one character at a time;
    // sanitizing drops any control bytes that arrive with it.
    if (!key.ctrl && !key.meta && input.length > 0) {
      const printable = sanitizeDisplay(input, 100);
      if (printable.length > 0) applyQuery(queryRef.current + printable);
    }
  });

  if (screen === 'loading') return <Text>Loading repositories…</Text>;

  if (screen === 'error') {
    return (
      <Box flexDirection="column">
        <Text color="red">Could not load repositories.</Text>
        <Text dimColor>{failure}</Text>
        <Text dimColor>Press any key to exit.</Text>
      </Box>
    );
  }

  if (screen === 'confirm') {
    return <Confirm repos={selectedRepos} action={action} typed={typed} error={confirmError} />;
  }

  if (screen === 'running' || screen === 'report') {
    return <Report results={results} running={screen === 'running'} total={batchTotal} />;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>reporeaper</Text>
        <Text dimColor>
          {'  '}
          {login} · action:{' '}
        </Text>
        <Text color={action === 'delete' ? 'red' : 'yellow'}>{action}</Text>
        <Text dimColor> (Tab to switch)</Text>
      </Box>

      {listing?.visibility.partial ? (
        <Text color="yellow">
          This token sees {listing.visibility.seen} of {listing.visibility.accountTotal}{' '}
          repositories on the account.
        </Text>
      ) : null}

      <Box marginTop={1}>
        <RepoList repos={visible} selectedIds={selectedIds} cursor={cursor} query={query} />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          type to search · ↑↓ move · space select · Enter continue ({selectedIds.size}) · Esc quit
        </Text>
      </Box>
    </Box>
  );
}
