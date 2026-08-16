import { sanitizeDisplay, type Repo, type RepoVisibilitySummary } from '@reporeaper/core';
import React from 'react';

/**
 * The repository table.
 *
 * No sortable columns, no stars, no size. Every extra way to reorder rows is
 * another way for a selection to end up pointing somewhere the user did not
 * look — and none of it helps anyone decide what to delete.
 */

export interface RepoTableProps {
  repos: Repo[];
  selectedIds: ReadonlySet<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  visibility: RepoVisibilitySummary;
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'caution';
}): React.JSX.Element {
  const color =
    tone === 'caution'
      ? 'border-[var(--color-caution-dim)] text-[var(--color-caution)]'
      : 'border-[var(--color-rule-strong)] text-[var(--color-ink-faint)]';

  return (
    <span
      className={`rounded-[var(--radius-sm)] border px-1.5 py-px font-[family-name:var(--font-display)] text-[length:var(--text-xs)] ${color}`}
    >
      {children}
    </span>
  );
}

export function RepoTable({
  repos,
  selectedIds,
  onToggle,
  onToggleAll,
  visibility,
}: RepoTableProps): React.JSX.Element {
  const selectableIds = repos.filter((repo) => repo.permissions.admin).map((repo) => repo.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

  return (
    <div className="flex flex-col">
      {visibility.partial ? (
        // A fine-grained token can return a complete-looking list that is
        // missing repositories entirely. Silence here reads as "that is all of
        // them", which is the wrong thing to believe before a cleanup.
        <p
          role="status"
          className="mb-4 border-l-2 border-[var(--color-caution)] bg-[var(--color-paper-2)] py-2 pl-3 text-[length:var(--text-sm)] text-[var(--color-caution)]"
        >
          This token can see {visibility.seen} of {visibility.accountTotal} repositories on the
          account. The rest are not listed below.
        </p>
      ) : null}

      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--color-rule-strong)]">
            <th scope="col" className="w-10 py-2 pr-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all listed repositories"
                className="size-3.5 accent-[var(--color-accent)]"
              />
            </th>
            <th
              scope="col"
              className="py-2 font-[family-name:var(--font-display)] text-[length:var(--text-xs)] font-normal tracking-[0.14em] text-[var(--color-ink-faint)] uppercase"
            >
              Repository
            </th>
            <th
              scope="col"
              className="hidden py-2 font-[family-name:var(--font-display)] text-[length:var(--text-xs)] font-normal tracking-[0.14em] text-[var(--color-ink-faint)] uppercase sm:table-cell"
            >
              State
            </th>
            <th
              scope="col"
              className="py-2 text-right font-[family-name:var(--font-display)] text-[length:var(--text-xs)] font-normal tracking-[0.14em] text-[var(--color-ink-faint)] uppercase"
            >
              Updated
            </th>
          </tr>
        </thead>

        <tbody>
          {repos.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-8 text-center text-[var(--color-ink-faint)]">
                Nothing matches that search.
              </td>
            </tr>
          ) : (
            repos.map((repo) => {
              const selected = selectedIds.has(repo.id);
              const blocked = !repo.permissions.admin;
              const forkNetwork = repo.fork || repo.forksCount > 0;

              return (
                <tr
                  key={repo.id}
                  data-selected={selected}
                  className="border-b border-[var(--color-rule)] transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)] data-[selected=true]:bg-[var(--color-paper-2)]"
                >
                  <td className="py-2 pr-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={blocked}
                      onChange={() => onToggle(repo.id)}
                      aria-label={`Select ${repo.name}`}
                      title={
                        blocked ? 'Your token has no admin rights on this repository' : undefined
                      }
                      className="mt-1 size-3.5 accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30"
                    />
                  </td>

                  <td className="py-2 align-top">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink)]">
                        {sanitizeDisplay(repo.name, 60)}
                      </span>
                      <span
                        data-numeric
                        className="font-[family-name:var(--font-display)] text-[length:var(--text-xs)] text-[var(--color-ink-faint)]"
                      >
                        #{repo.id}
                      </span>
                      {blocked ? <Badge tone="caution">no admin</Badge> : null}
                    </div>

                    {repo.description ? (
                      <p className="mt-0.5 max-w-[70ch] truncate text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
                        {sanitizeDisplay(repo.description, 140)}
                      </p>
                    ) : null}

                    <div className="mt-1 flex flex-wrap gap-1.5 sm:hidden">
                      {repo.private ? <Badge>private</Badge> : null}
                      {repo.archived ? <Badge>archived</Badge> : null}
                      {forkNetwork ? <Badge tone="caution">fork network</Badge> : null}
                    </div>
                  </td>

                  <td className="hidden py-2 align-top sm:table-cell">
                    <div className="flex flex-wrap gap-1.5">
                      {repo.private ? <Badge>private</Badge> : <Badge>public</Badge>}
                      {repo.archived ? <Badge>archived</Badge> : null}
                      {forkNetwork ? <Badge tone="caution">fork network</Badge> : null}
                    </div>
                  </td>

                  <td
                    data-numeric
                    className="py-2 text-right align-top font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink-faint)]"
                  >
                    {relativeDate(repo.updatedAt)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
