import type { Repo, RepoListing } from '@reporeaper/core';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app.js';

/**
 * Behavioural tests for the web UI, driven through the real components with a
 * stubbed `fetch` standing in for the proxy.
 *
 * The two that matter most: a selection must survive a filter change and act on
 * the repositories the user chose, and the token must never be reachable from
 * anywhere but the provider that holds it.
 */

function makeRepo(id: number, name: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    name,
    fullName: `octocat/${name}`,
    owner: { login: 'octocat', type: 'User' },
    description: null,
    private: false,
    fork: false,
    forksCount: 0,
    archived: false,
    htmlUrl: `https://github.com/octocat/${name}`,
    updatedAt: new Date().toISOString(),
    permissions: { admin: true, push: true, pull: true },
    ...overrides,
  };
}

const REPOS = [
  makeRepo(101, 'alpha-one'),
  makeRepo(102, 'alpha-two'),
  makeRepo(103, 'beta-one'),
  makeRepo(104, 'beta-two', { fork: true }),
  makeRepo(105, 'gamma-one', { permissions: { admin: false, push: true, pull: true } }),
];

interface StubOptions {
  mode?: 'local' | 'byo';
  tokenState?: 'ok' | 'absent' | 'invalid';
  listing?: Partial<RepoListing>;
}

/** Records every /api/actions call so tests can assert what was acted on. */
let actionCalls: Array<{ action: string; repo: { id: number; name: string } }> = [];

function stubFetch(options: StubOptions = {}): void {
  const mode = options.mode ?? 'local';
  const tokenState = options.tokenState ?? 'ok';

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.endsWith('/api/me')) {
        const status = tokenState === 'ok' ? 200 : tokenState === 'absent' ? 401 : 403;
        return new Response(
          JSON.stringify({ mode, tokenState, login: 'octocat', tokenType: 'classic' }),
          { status, headers: { 'content-type': 'application/json' } },
        );
      }

      if (url.endsWith('/api/repos')) {
        const listing: RepoListing = {
          repos: REPOS,
          visibility: {
            tokenKind: 'classic',
            seen: REPOS.length,
            accountTotal: REPOS.length,
            partial: false,
          },
          ...options.listing,
        };
        return new Response(JSON.stringify(listing), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (url.endsWith('/api/actions')) {
        const body = JSON.parse(String(init?.body)) as {
          action: string;
          repo: { id: number; owner: string; name: string };
        };
        actionCalls.push({ action: body.action, repo: { id: body.repo.id, name: body.repo.name } });
        return new Response(
          JSON.stringify({ repo: body.repo, action: body.action, ok: true, outcome: 'ok' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      throw new Error(`Unexpected request: ${url}`);
    }),
  );
}

beforeEach(() => {
  actionCalls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function checkboxFor(name: string): Promise<HTMLElement> {
  return screen.findByRole('checkbox', { name: `Select ${name}` });
}

describe('selection integrity', () => {
  it('acts on the repositories chosen under earlier filters, not on row positions', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    const search = await screen.findByLabelText('Filter repositories');

    // Select one repository under the "beta" filter.
    await user.type(search, 'beta-one');
    await user.click(await checkboxFor('beta-one'));

    // Change the filter completely — the rows underneath are different now.
    await user.clear(search);
    await user.type(search, 'alpha-two');
    await user.click(await checkboxFor('alpha-two'));

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    // Both selections are listed, by id, even though only one was ever visible
    // at a time.
    expect(within(dialog).getByText('#103')).toBeDefined();
    expect(within(dialog).getByText('#102')).toBeDefined();

    await user.type(within(dialog).getByLabelText('Type 2 to confirm'), '2');
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));

    // Mutations are paced a second apart on purpose, so the second call lands
    // after waitFor's default 1s budget. Widen the wait rather than removing
    // the pacing the rate limit requires.
    await waitFor(() => expect(actionCalls).toHaveLength(2), { timeout: 8000 });
    expect(actionCalls.map((call) => call.repo.name).sort()).toEqual(['alpha-two', 'beta-one']);
    expect(actionCalls.every((call) => call.action === 'delete')).toBe(true);
  });

  it('does not let a repository without admin rights be selected', async () => {
    stubFetch();
    render(<App />);

    const blocked = await checkboxFor('gamma-one');
    expect((blocked as HTMLInputElement).disabled).toBe(true);
  });
});

describe('confirmation gate', () => {
  it('refuses to act until the exact count is typed', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await checkboxFor('alpha-one'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Delete permanently' });

    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(within(dialog).getByLabelText('Type 1 to confirm'), '2');
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.clear(within(dialog).getByLabelText('Type 1 to confirm'));
    await user.type(within(dialog).getByLabelText('Type 1 to confirm'), '1');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    expect(actionCalls).toHaveLength(0);
  });

  it('warns that fork-network repositories cannot be restored', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await checkboxFor('beta-two'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be restored/i)).toBeDefined();
  });

  it('does not claim archiving is irreversible', async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<App />);

    await user.click(await checkboxFor('beta-two'));
    await user.click(screen.getByRole('button', { name: 'Archive' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/unarchive it at any time/i)).toBeDefined();
    expect(within(dialog).queryByText(/cannot be restored/i)).toBeNull();
  });
});

describe('token handling', () => {
  it('shows the gate for a self-hosted instance with no token', async () => {
    stubFetch({ mode: 'byo', tokenState: 'absent' });
    render(<App />);

    expect(await screen.findByLabelText('Personal access token')).toBeDefined();
  });

  it('says the token was rejected rather than that it is missing', async () => {
    stubFetch({ mode: 'byo', tokenState: 'invalid' });
    render(<App />);

    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toMatch(/rejected/i);
  });

  it('skips the gate entirely in local mode', async () => {
    stubFetch({ mode: 'local', tokenState: 'ok' });
    render(<App />);

    await screen.findByLabelText('Filter repositories');
    expect(screen.queryByLabelText('Personal access token')).toBeNull();
  });

  it('never puts the token on window or in storage', async () => {
    stubFetch({ mode: 'byo', tokenState: 'absent' });
    const user = userEvent.setup();
    render(<App />);

    const secret = 'ghp_pastedbytheuser0000000000000000';
    await user.type(await screen.findByLabelText('Personal access token'), secret);

    const serializedWindow = Object.keys(window)
      .map((key) => {
        try {
          return String((window as unknown as Record<string, unknown>)[key]);
        } catch {
          return '';
        }
      })
      .join(' ');

    expect(serializedWindow).not.toContain(secret);
    expect(JSON.stringify(window.localStorage)).not.toContain(secret);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(secret);
    expect(document.cookie).not.toContain(secret);
  });
});

describe('server unreachable', () => {
  it('says the server could not be reached instead of failing silently', async () => {
    // The regression this pins: pressing Continue with no server running left
    // the gate exactly as it was, with no indication anything had happened.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText('Personal access token'), 'ghp_something');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not reach the reporeaper server/i);
    expect(alert.textContent).not.toMatch(/rejected/i);
  });
});

describe('restricted token visibility', () => {
  it('says how many repositories the token cannot see', async () => {
    stubFetch({
      listing: {
        visibility: { tokenKind: 'fine-grained', seen: 5, accountTotal: 40, partial: true },
      },
    });
    render(<App />);

    const banner = await screen.findByRole('status');
    expect(banner.textContent).toMatch(/5 of 40/);
  });
});
