import {
  NotFoundError,
  PermissionError,
  SecondaryRateLimitError,
  type Provider,
  type Repo,
} from '@reporeaper/core';
import { describe, expect, it, vi } from 'vitest';
import { runBatch } from '../batch-runner.js';

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 1,
    name: 'demo',
    fullName: 'octocat/demo',
    owner: { login: 'octocat', type: 'User' },
    description: null,
    private: false,
    fork: false,
    forksCount: 0,
    archived: false,
    htmlUrl: 'https://github.com/octocat/demo',
    updatedAt: '2026-01-01T00:00:00Z',
    permissions: { admin: true, push: true, pull: true },
    ...overrides,
  };
}

function stubProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    getViewer: vi.fn().mockResolvedValue({ login: 'octocat', tokenKind: 'classic' }),
    listAllRepos: vi.fn(),
    getRepo: vi
      .fn()
      .mockImplementation((_owner: string, name: string) =>
        Promise.resolve(makeRepo({ id: Number(name.split('-')[1] ?? 1), name })),
      ),
    deleteRepo: vi.fn().mockResolvedValue(undefined),
    archiveRepo: vi.fn().mockResolvedValue(makeRepo()),
    ...overrides,
  } as Provider;
}

const options = { authenticatedLogin: 'octocat', sleep: () => Promise.resolve() };

describe('runBatch', () => {
  it('acts on exactly the repositories it was given, in order', async () => {
    const repos = [
      makeRepo({ id: 1, name: 'repo-1' }),
      makeRepo({ id: 2, name: 'repo-2' }),
      makeRepo({ id: 3, name: 'repo-3' }),
    ];
    const provider = stubProvider();

    const summary = await runBatch(provider, repos, 'delete', options);

    expect(summary.succeeded).toHaveLength(3);
    expect(vi.mocked(provider.deleteRepo).mock.calls.map((call) => call[1])).toEqual([
      'repo-1',
      'repo-2',
      'repo-3',
    ]);
  });

  it('paces between mutations rather than firing them back to back', async () => {
    const sleeps: number[] = [];
    const repos = [makeRepo({ id: 1, name: 'repo-1' }), makeRepo({ id: 2, name: 'repo-2' })];

    await runBatch(stubProvider(), repos, 'delete', {
      authenticatedLogin: 'octocat',
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });

    // One gap between two repositories, at the default floor of a second.
    expect(sleeps).toEqual([1000]);
  });

  it('backs off and retries once after a secondary rate limit', async () => {
    const sleeps: number[] = [];
    const deleteRepo = vi
      .fn()
      .mockRejectedValueOnce(new SecondaryRateLimitError(30))
      .mockResolvedValueOnce(undefined);

    const summary = await runBatch(
      stubProvider({ deleteRepo }),
      [makeRepo({ id: 1, name: 'repo-1' })],
      'delete',
      {
        authenticatedLogin: 'octocat',
        sleep: (ms) => {
          sleeps.push(ms);
          return Promise.resolve();
        },
      },
    );

    expect(sleeps).toContain(60_000);
    expect(deleteRepo).toHaveBeenCalledTimes(2);
    expect(summary.succeeded).toHaveLength(1);
  });

  it('counts a 404-after-delete as done, not as a failure to retry', async () => {
    const summary = await runBatch(
      stubProvider({ deleteRepo: vi.fn().mockRejectedValue(new NotFoundError()) }),
      [makeRepo({ id: 1, name: 'repo-1' })],
      'delete',
      options,
    );

    expect(summary.succeeded).toHaveLength(1);
    expect(summary.remaining).toHaveLength(0);
  });

  it('keeps only the unsuccessful repositories in the retry set', async () => {
    const repos = [
      makeRepo({ id: 1, name: 'repo-1' }),
      makeRepo({ id: 2, name: 'repo-2' }),
      makeRepo({ id: 3, name: 'repo-3' }),
    ];
    // A permission error is not retried — only rate limits are — so these three
    // outcomes map one-to-one onto the three repositories.
    const deleteRepo = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new PermissionError('needs admin'))
      .mockResolvedValueOnce(undefined);

    const summary = await runBatch(stubProvider({ deleteRepo }), repos, 'delete', options);

    expect(summary.remaining.map((repo) => repo.id)).toEqual([2]);
  });

  it('reports progress for every repository as it completes', async () => {
    const seen: string[] = [];
    const repos = [makeRepo({ id: 1, name: 'repo-1' }), makeRepo({ id: 2, name: 'repo-2' })];

    await runBatch(stubProvider(), repos, 'archive', {
      ...options,
      onResult: (result) => seen.push(result.repo.name),
    });

    expect(seen).toEqual(['repo-1', 'repo-2']);
  });

  it('never mutates a repository whose live id no longer matches', async () => {
    const deleteRepo = vi.fn();
    const provider = stubProvider({
      // The name still resolves, but to a different repository.
      getRepo: vi.fn().mockResolvedValue(makeRepo({ id: 999, name: 'repo-1' })),
      deleteRepo,
    });

    const summary = await runBatch(
      provider,
      [makeRepo({ id: 1, name: 'repo-1' })],
      'delete',
      options,
    );

    expect(deleteRepo).not.toHaveBeenCalled();
    expect(summary.failed[0]?.outcome).toBe('changed-since-listing');
  });
});
