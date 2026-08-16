import { sanitizeDisplay, type ActionResult } from '@reporeaper/core';
import React from 'react';

/**
 * Live progress and the final report.
 *
 * Every repository gets a line as it completes, not a percentage bar. The
 * per-item record is the point: if this run is interrupted, whatever is on
 * screen is exactly what happened.
 */

export interface BatchReportProps {
  results: ActionResult[];
  total: number;
  running: boolean;
  onRetry: () => void;
  onDone: () => void;
}

function toneFor(result: ActionResult): { glyph: string; color: string; label: string } {
  switch (result.outcome) {
    case 'ok':
      return {
        glyph: '✓',
        color: 'var(--color-accent)',
        label: result.action === 'delete' ? 'deleted' : 'archived',
      };
    case 'already-gone':
      return { glyph: '✓', color: 'var(--color-accent-dim)', label: 'already gone' };
    case 'changed-since-listing':
      return {
        glyph: '!',
        color: 'var(--color-caution)',
        label: result.error ?? 'changed since listing — skipped',
      };
    default:
      return { glyph: '✗', color: 'var(--color-danger)', label: result.error ?? 'failed' };
  }
}

export function BatchReport({
  results,
  total,
  running,
  onRetry,
  onDone,
}: BatchReportProps): React.JSX.Element {
  const failed = results.filter((result) => !result.ok);

  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between border-b border-[var(--color-rule-strong)] pb-2">
        <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] tracking-[0.14em] text-[var(--color-ink-faint)] uppercase">
          {running ? 'Working' : 'Finished'}
        </h2>
        <span
          data-numeric
          className="font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink-dim)]"
        >
          {results.length} / {total}
        </span>
      </header>

      <ol className="mt-2">
        {results.map((result) => {
          const tone = toneFor(result);
          return (
            <li
              key={`${result.repo.id}-${result.action}`}
              className="flex items-baseline gap-3 border-b border-[var(--color-rule)] py-1.5 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] motion-safe:animate-[fade-in_var(--dur-short)_var(--ease-out)]"
            >
              <span style={{ color: tone.color }}>{tone.glyph}</span>
              <span className="truncate text-[var(--color-ink)]">
                {sanitizeDisplay(result.repo.name, 50)}
              </span>
              <span data-numeric className="shrink-0 text-[var(--color-ink-faint)]">
                #{result.repo.id}
              </span>
              <span className="ml-auto truncate text-right text-[var(--color-ink-faint)]">
                {sanitizeDisplay(tone.label, 90)}
              </span>
            </li>
          );
        })}
      </ol>

      {!running ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <p className="text-[length:var(--text-sm)] text-[var(--color-ink-dim)]">
            {results.length - failed.length} succeeded, {failed.length} failed.
          </p>
          <div className="ml-auto flex gap-3">
            {failed.length > 0 ? (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap text-[var(--color-ink)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
              >
                Retry {failed.length}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDone}
              className="rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-4 py-2 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap text-[var(--color-paper)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:border-[var(--color-ink)] hover:bg-[var(--color-ink)]"
            >
              Back to list
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
