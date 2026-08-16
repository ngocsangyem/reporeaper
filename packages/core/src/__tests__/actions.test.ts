import { describe, expect, it, vi } from 'vitest';
import { runAction } from '../actions.js';
import { NotFoundError, PermissionError, SecondaryRateLimitError } from '../errors.js';
import type { Provider } from '../provider.js';
import { toRepoRef } from '../types.js';
import type { Repo } from '../types.js';

function makeRepo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 42,
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

/** A provider stub whose behaviour each test sets explicitly. */
function stubProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    getViewer: vi.fn(),
    listAllRepos: vi.fn(),
    getRepo: vi.fn(),
    deleteRepo: vi.fn(),
    archiveRepo: vi.fn(),
    ...overrides,
  } as Provider;
}

const options = { authenticatedLogin: 'octocat' };

describe('runAction identity verification', () => {
  it('deletes when the live repository is the selected one', async () => {
    const repo = makeRepo();
    const deleteRepo = vi.fn().mockResolvedValue(undefined);
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(repo), deleteRepo });

    const result = await runAction(provider, toRepoRef(repo), 'delete', options);

    expect(result).toMatchObject({ ok: true, outcome: 'ok' });
    expect(deleteRepo).toHaveBeenCalledWith('octocat', 'demo');
  });

  it('refuses to act when the name now points at a different repository', async () => {
    const selected = makeRepo({ id: 42 });
    // Same name, different id: the original was renamed or deleted and something
    // else took the name. Acting here would destroy an unrelated repository.
    const live = makeRepo({ id: 999 });
    const deleteRepo = vi.fn();
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(live), deleteRepo });

    const result = await runAction(provider, toRepoRef(selected), 'delete', options);

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe('changed-since-listing');
    expect(deleteRepo).not.toHaveBeenCalled();
  });

  it('refuses to act on a repository owned by an organization', async () => {
    const selected = makeRepo();
    const live = makeRepo({ owner: { login: 'acme-corp', type: 'Organization' } });
    const deleteRepo = vi.fn();
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(live), deleteRepo });

    const result = await runAction(provider, toRepoRef(selected), 'delete', options);

    expect(result.outcome).toBe('changed-since-listing');
    expect(deleteRepo).not.toHaveBeenCalled();
  });

  it('refuses to act on a repository owned by another account', async () => {
    const selected = makeRepo();
    const live = makeRepo({ owner: { login: 'someone-else', type: 'User' } });
    const deleteRepo = vi.fn();
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(live), deleteRepo });

    const result = await runAction(provider, toRepoRef(selected), 'delete', options);

    expect(result.outcome).toBe('changed-since-listing');
    expect(deleteRepo).not.toHaveBeenCalled();
  });
});

describe('runAction outcomes', () => {
  it('does not claim success when the repository cannot be seen before acting', async () => {
    // A 404 at the pre-check is ambiguous: already deleted, or no longer
    // visible to this token. Reporting "deleted" would be the one lie that
    // matters — the user would believe a repository is gone while it exists.
    const repo = makeRepo();
    const deleteRepo = vi.fn();
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(null), deleteRepo });

    const result = await runAction(provider, toRepoRef(repo), 'delete', options);

    expect(result).toMatchObject({ ok: false, outcome: 'failed', code: 'not-visible' });
    expect(result.error).toMatch(/may already be deleted, or this token may no longer have access/);
    expect(deleteRepo).not.toHaveBeenCalled();
  });

  it('treats a 404 during the delete itself as already-gone, because the id was just verified', async () => {
    const repo = makeRepo();
    const provider = stubProvider({
      getRepo: vi.fn().mockResolvedValue(repo),
      deleteRepo: vi.fn().mockRejectedValue(new NotFoundError()),
    });

    const result = await runAction(provider, toRepoRef(repo), 'delete', options);

    expect(result).toMatchObject({ ok: true, outcome: 'already-gone' });
  });

  it('treats an absent repository as a failure for archive too', async () => {
    const repo = makeRepo();
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(null) });

    const result = await runAction(provider, toRepoRef(repo), 'archive', options);

    expect(result).toMatchObject({ ok: false, outcome: 'failed', code: 'not-visible' });
  });

  it('reports a permission failure without throwing, so a batch can continue', async () => {
    const repo = makeRepo();
    const provider = stubProvider({
      getRepo: vi.fn().mockResolvedValue(repo),
      deleteRepo: vi.fn().mockRejectedValue(new PermissionError('needs admin')),
    });

    const result = await runAction(provider, toRepoRef(repo), 'delete', options);

    expect(result).toMatchObject({ ok: false, outcome: 'failed', code: 'permission-denied' });
  });

  it('surfaces a secondary rate limit as its own code so the caller can back off', async () => {
    const repo = makeRepo();
    const provider = stubProvider({
      getRepo: vi.fn().mockResolvedValue(repo),
      deleteRepo: vi.fn().mockRejectedValue(new SecondaryRateLimitError(30)),
    });

    const result = await runAction(provider, toRepoRef(repo), 'delete', options);

    expect(result.code).toBe('secondary-rate-limit');
  });

  it('archives through the provider when verification passes', async () => {
    const repo = makeRepo();
    const archiveRepo = vi.fn().mockResolvedValue(makeRepo({ archived: true }));
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(repo), archiveRepo });

    const result = await runAction(provider, toRepoRef(repo), 'archive', options);

    expect(result).toMatchObject({ ok: true, outcome: 'ok' });
    expect(archiveRepo).toHaveBeenCalledWith('octocat', 'demo');
  });
});
