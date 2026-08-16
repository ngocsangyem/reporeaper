import { sanitizeDisplay, type Repo, type RepoAction } from '@reporeaper/core';
import * as Dialog from '@radix-ui/react-dialog';
import React, { useEffect, useState } from 'react';

/**
 * The confirmation. This is the moment the whole interface exists to get right.
 *
 * Three deliberate choices:
 *   - Typing the count, not clicking OK. It forces the number to be read.
 *   - The id beside every name. Names are the spoofable part; ids are identity.
 *   - Red appears here and nowhere else in the app, and only for delete.
 *     Archive gets the same care with a calmer palette, because it is undoable
 *     and pretending otherwise would flatten the distinction that matters.
 */

export interface ConfirmDialogProps {
  open: boolean;
  action: RepoAction;
  repos: Repo[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function notRestorable(repos: Repo[]): Repo[] {
  return repos.filter((repo) => repo.fork || repo.forksCount > 0);
}

export function ConfirmDialog({
  open,
  action,
  repos,
  onCancel,
  onConfirm,
}: ConfirmDialogProps): React.JSX.Element {
  const [typed, setTyped] = useState('');
  const isDelete = action === 'delete';
  const required = String(repos.length);
  const matches = typed === required;
  const irreversible = notRestorable(repos);

  useEffect(() => {
    if (open) setTyped('');
  }, [open, repos.length]);

  const accent = isDelete ? 'var(--color-danger)' : 'var(--color-caution)';

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[20] bg-[var(--color-paper)]/80 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-[30] max-h-[85svh] w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border bg-[var(--color-paper-2)] p-6"
          style={{ borderColor: accent }}
          aria-describedby="confirm-body"
        >
          <Dialog.Title
            className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-semibold tracking-tight"
            style={{ color: accent }}
          >
            {isDelete ? 'Delete' : 'Archive'} {repos.length}{' '}
            {repos.length === 1 ? 'repository' : 'repositories'}
          </Dialog.Title>

          <div id="confirm-body">
            <ul className="mt-4 max-h-52 overflow-y-auto border-y border-[var(--color-rule)] py-2">
              {repos.map((repo) => (
                <li
                  key={repo.id}
                  className="flex items-baseline justify-between gap-3 py-0.5 font-[family-name:var(--font-display)] text-[length:var(--text-sm)]"
                >
                  <span className="truncate text-[var(--color-ink)]">
                    {sanitizeDisplay(repo.name, 50)}
                  </span>
                  <span data-numeric className="shrink-0 text-[var(--color-ink-faint)]">
                    #{repo.id}
                  </span>
                </li>
              ))}
            </ul>

            {isDelete ? (
              <div className="mt-4 text-[length:var(--text-sm)]">
                {irreversible.length > 0 ? (
                  // "Restorable within 90 days" is simply false for anything in
                  // a fork network. Saying it anyway would be a reassurance the
                  // product cannot honour.
                  <p className="text-[var(--color-danger)]">
                    {irreversible.length} of these {irreversible.length === 1 ? 'is' : 'are'} in a
                    fork network and <strong className="font-semibold">cannot be restored</strong>{' '}
                    by GitHub support.
                  </p>
                ) : (
                  <p className="text-[var(--color-ink-dim)]">
                    GitHub can usually restore a deleted repository within 90 days — though never
                    one that belongs to a fork network.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 text-[length:var(--text-sm)] text-[var(--color-ink-dim)]">
                Archiving makes a repository read-only. You can unarchive it at any time.
              </p>
            )}

            <form
              className="mt-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (matches) onConfirm();
              }}
            >
              <label
                htmlFor="confirm-count"
                className="font-[family-name:var(--font-display)] text-[length:var(--text-xs)] tracking-[0.14em] text-[var(--color-ink-faint)] uppercase"
              >
                Type {required} to confirm
              </label>
              <div className="mt-2 flex gap-3">
                <input
                  id="confirm-count"
                  inputMode="numeric"
                  autoComplete="off"
                  value={typed}
                  onChange={(event) => setTyped(event.target.value.trim())}
                  className="w-24 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-paper)] px-3 py-2 text-center font-[family-name:var(--font-display)] text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
                />
                <button
                  type="submit"
                  disabled={!matches}
                  className="flex-1 rounded-[var(--radius-sm)] border px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-35"
                  style={{
                    borderColor: accent,
                    color: matches ? 'var(--color-paper)' : accent,
                    background: matches ? accent : 'transparent',
                  }}
                >
                  {isDelete ? 'Delete permanently' : 'Archive'}
                </button>
              </div>
            </form>

            <Dialog.Close asChild>
              <button
                type="button"
                className="mt-3 w-full py-1.5 text-[length:var(--text-sm)] text-[var(--color-ink-faint)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:text-[var(--color-ink)]"
              >
                Cancel
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
