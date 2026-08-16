import type { Provider, Repo } from '@reporeaper/core';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { windowFor } from '../tui/repo-list.js';
import { App } from '../tui/app.js';

/**
 * Selection integrity under filtering.
 *
 * This is the failure the whole design guards against: the user filters,
 * selects a few repositories, changes the filter, and confirms — and the tool
 * deletes whatever happened to occupy those positions instead of what was
 * chosen. Selection is keyed by repository id for exactly this reason, and this
 * test drives the real component to prove it.
 */

function makeRepo(id: number, name: string): Repo {
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
    updatedAt: '2026-01-01T00:00:00Z',
    permissions: { admin: true, push: true, pull: true },
  };
}

const REPOS = [
  makeRepo(101, 'alpha-one'),
  makeRepo(102, 'alpha-two'),
  makeRepo(103, 'beta-one'),
  makeRepo(104, 'beta-two'),
  makeRepo(105, 'gamma-one'),
];

function stubProvider(deleteRepo = vi.fn().mockResolvedValue(undefined)): Provider {
  return {
    getViewer: vi.fn().mockResolvedValue({ login: 'octocat', tokenKind: 'classic' }),
    listAllRepos: vi.fn().mockResolvedValue({
      repos: REPOS,
      visibility: {
        tokenKind: 'classic',
        seen: REPOS.length,
        accountTotal: REPOS.length,
        partial: false,
      },
    }),
    getRepo: vi
      .fn()
      .mockImplementation((_owner: string, name: string) =>
        Promise.resolve(REPOS.find((repo) => repo.name === name) ?? null),
      ),
    deleteRepo,
    archiveRepo: vi.fn().mockResolvedValue(REPOS[0]),
  } as unknown as Provider;
}

/** Lets queued promises and effects settle between keystrokes. */
async function settle(times = 4): Promise<void> {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

// Control sequences built from code points: written literally they are
// invisible in source and do not survive a copy-paste.
const ENTER = String.fromCharCode(13);
const BACKSPACE = String.fromCharCode(127);
const DOWN = `${String.fromCharCode(27)}[B`;

describe('windowFor', () => {
  it('renders everything when the list fits', () => {
    expect(windowFor(5, 0, 12)).toEqual({ start: 0, end: 5 });
  });

  it('keeps the cursor inside the window for a long list', () => {
    expect(windowFor(1000, 0, 10)).toEqual({ start: 0, end: 10 });
    expect(windowFor(1000, 500, 10)).toEqual({ start: 495, end: 505 });
    // At the end the window stops rather than running past the last row.
    expect(windowFor(1000, 999, 10)).toEqual({ start: 990, end: 1000 });
  });
});

describe('TUI selection integrity', () => {
  it('acts on the repositories selected under an earlier filter, not on positions', async () => {
    const deleteRepo = vi.fn().mockResolvedValue(undefined);
    const { stdin, unmount } = render(
      <App provider={stubProvider(deleteRepo)} sleep={() => Promise.resolve()} />,
    );
    await settle();

    // Filter to the two "beta" repositories and select the first of them.
    stdin.write('beta');
    await settle();
    stdin.write(' ');
    await settle();

    // Now change the filter entirely. Position 0 is a different repository.
    for (let index = 0; index < 4; index += 1) stdin.write(BACKSPACE);
    await settle();
    stdin.write('gamma');
    await settle();
    stdin.write(' ');
    await settle();

    // Switch to delete, confirm with the count.
    stdin.write('\t');
    await settle();
    stdin.write(ENTER);
    await settle();
    stdin.write('2');
    stdin.write(ENTER);
    await settle(8);

    const acted = deleteRepo.mock.calls.map((call) => call[1]).sort();
    expect(acted).toEqual(['beta-one', 'gamma-one']);

    unmount();
  });

  it('refuses to proceed when the typed count is wrong', async () => {
    const deleteRepo = vi.fn().mockResolvedValue(undefined);
    const { stdin, lastFrame, unmount } = render(
      <App provider={stubProvider(deleteRepo)} sleep={() => Promise.resolve()} />,
    );
    await settle();

    stdin.write(' ');
    await settle();
    stdin.write(DOWN);
    stdin.write(' ');
    await settle();

    stdin.write(ENTER);
    await settle();
    // Two are selected; typing 3 must not proceed.
    stdin.write('3');
    stdin.write(ENTER);
    await settle();

    expect(deleteRepo).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('Type 2 exactly');

    unmount();
  });
});
