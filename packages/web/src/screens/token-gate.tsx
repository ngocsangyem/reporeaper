import React, { useState } from 'react';
import { useSession } from '../state/session.js';

/**
 * The token gate — self-hosted mode only.
 *
 * The copy is deliberately plain about the trust model. A tool that deletes
 * repositories has to be honest about where the credential goes, and "kept in
 * memory" is only credible if the page also admits the refresh cost.
 */
export function TokenGate(): React.JSX.Element {
  const { setToken, tokenState, me } = useSession();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const rejected = tokenState === 'invalid';
  const unreachable = tokenState === 'unreachable';

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (value.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      await setToken(value);
    } finally {
      // Drop the local copy either way: on success the provider holds it, and
      // on failure there is no reason for the rejected value to sit in the
      // input and in component state.
      setValue('');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-[46rem] flex-col justify-center px-6 py-16">
      <p
        className="font-[family-name:var(--font-display)] text-[length:var(--text-xs)] tracking-[0.2em] text-[var(--color-accent)] uppercase"
        data-testid="wordmark"
      >
        reporeaper
      </p>

      <h1 className="mt-4 font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] leading-tight font-semibold text-[var(--color-ink)]">
        Bring your own token.
      </h1>

      <p className="mt-4 max-w-[52ch] text-[var(--color-ink-dim)]">
        This instance holds nothing. Your token stays in this tab&rsquo;s memory, is sent with each
        request, and is gone when you close it — including on refresh, which means you will paste it
        again. That is the trade for not storing it.
      </p>

      <form onSubmit={submit} className="mt-8">
        <label
          htmlFor="token"
          className="font-[family-name:var(--font-display)] text-[length:var(--text-xs)] tracking-[0.14em] text-[var(--color-ink-faint)] uppercase"
        >
          Personal access token
        </label>

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="github_pat_… or ghp_…"
            aria-invalid={rejected}
            aria-describedby={rejected ? 'token-error' : undefined}
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-rule-strong)] bg-[var(--color-paper-2)] px-3 py-2.5 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] text-[var(--color-ink)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] outline-none placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={busy || value.trim().length === 0}
            className="rounded-[var(--radius-sm)] border border-[var(--color-accent)] bg-[var(--color-accent)] px-5 py-2.5 font-[family-name:var(--font-display)] text-[length:var(--text-sm)] whitespace-nowrap text-[var(--color-paper)] transition-colors duration-[var(--dur-short)] ease-[var(--ease-out)] hover:bg-[var(--color-ink)] hover:border-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </div>

        {rejected ? (
          <p
            id="token-error"
            role="alert"
            className="mt-3 text-[length:var(--text-sm)] text-[var(--color-danger)]"
          >
            GitHub rejected that token. Check it has not expired, and that it grants administration
            rights on the repositories you want to remove.
          </p>
        ) : null}

        {unreachable ? (
          // Not the token's fault, so it does not get the token's error copy.
          <p role="alert" className="mt-3 text-[length:var(--text-sm)] text-[var(--color-caution)]">
            {me?.message ??
              'GitHub could not be reached, so the token could not be checked. This is not a ' +
                'problem with the token itself — try again in a moment.'}
          </p>
        ) : null}

        {!unreachable && me?.message ? (
          <p className="mt-3 text-[length:var(--text-sm)] text-[var(--color-caution)]">
            {me.message}
          </p>
        ) : null}
      </form>

      <div className="mt-10 border-t border-[var(--color-rule)] pt-6 text-[length:var(--text-sm)] text-[var(--color-ink-faint)]">
        <p className="max-w-[60ch]">
          A fine-grained token needs read access to metadata and administration rights on the
          repositories you intend to delete. Archiving needs less. The README lists the exact
          permissions.
        </p>
        <p className="mt-3 max-w-[60ch]">
          Running this on your own machine instead? Use{' '}
          <code className="font-[family-name:var(--font-display)] text-[var(--color-accent)]">
            npx reporeaper
          </code>{' '}
          and no token ever reaches a browser.
        </p>
      </div>
    </main>
  );
}
