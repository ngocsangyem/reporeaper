import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  PermissionError,
  PrimaryRateLimitError,
  SecondaryRateLimitError,
  TokenInvalidError,
} from '../errors.js';
import { GitHubProvider } from '../github/provider.js';
import { GitHubToken } from '../token.js';
import {
  API,
  paginatedReposHandler,
  permissionDeniedResponse,
  primaryRateLimitResponse,
  repoPayload,
  secondaryRateLimitResponse,
  viewerHandler,
} from './fixtures/github-fixtures.js';

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});
afterEach(() => {
  server.resetHandlers();
});
afterAll(() => {
  server.close();
});

function provider(): GitHubProvider {
  return new GitHubProvider(new GitHubToken('ghp_testtoken000000000000000000000000'));
}

describe('listAllRepos', () => {
  it('walks every page of the Link header, not just the first', async () => {
    const first = Array.from({ length: 100 }, (_, index) =>
      repoPayload({ id: index + 1, name: `repo-${index + 1}` }),
    );
    const second = Array.from({ length: 37 }, (_, index) =>
      repoPayload({ id: 101 + index, name: `repo-${101 + index}` }),
    );

    server.use(viewerHandler({ publicRepos: 137 }), paginatedReposHandler([first, second]));

    const listing = await provider().listAllRepos();

    expect(listing.repos).toHaveLength(137);
    expect(listing.repos.at(-1)?.name).toBe('repo-137');
  });

  it('flags a token that sees fewer repositories than the account owns', async () => {
    server.use(
      viewerHandler({ publicRepos: 40, privateRepos: 10 }),
      paginatedReposHandler([[repoPayload({ id: 1, name: 'only-one' })]]),
    );

    const listing = await provider().listAllRepos();

    expect(listing.visibility.seen).toBe(1);
    expect(listing.visibility.accountTotal).toBe(50);
    expect(listing.visibility.partial).toBe(true);
  });

  it('does not invent an account total when the token cannot see the counts', async () => {
    server.use(
      viewerHandler({ omitCounts: true }),
      paginatedReposHandler([[repoPayload({ id: 1, name: 'only-one' })]]),
    );

    const listing = await provider().listAllRepos();

    // Guessing zero here would claim the listing is complete when it is unknown.
    expect(listing.visibility.accountTotal).toBeUndefined();
    expect(listing.visibility.partial).toBe(false);
  });

  it('preserves per-repo admin permission so non-deletable repos can be disabled', async () => {
    server.use(
      viewerHandler(),
      paginatedReposHandler([
        [
          repoPayload({ id: 1, name: 'mine', admin: true }),
          repoPayload({ id: 2, name: 'readonly', admin: false }),
        ],
      ]),
    );

    const listing = await provider().listAllRepos();

    expect(listing.repos[0]?.permissions.admin).toBe(true);
    expect(listing.repos[1]?.permissions.admin).toBe(false);
  });
});

describe('error classification', () => {
  it('maps a secondary rate limit to its own class, never to a permission error', async () => {
    server.use(http.delete(`${API}/repos/octocat/demo`, () => secondaryRateLimitResponse(42)));

    const error = await provider()
      .deleteRepo('octocat', 'demo')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SecondaryRateLimitError);
    expect(error).not.toBeInstanceOf(PermissionError);
    expect((error as SecondaryRateLimitError).retryAfterSeconds).toBe(42);
  });

  it('maps an exhausted quota to the primary rate limit, with its reset time', async () => {
    const resetAt = Math.floor(Date.now() / 1000) + 600;
    server.use(http.delete(`${API}/repos/octocat/demo`, () => primaryRateLimitResponse(resetAt)));

    const error = await provider()
      .deleteRepo('octocat', 'demo')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PrimaryRateLimitError);
    expect((error as PrimaryRateLimitError).resetAt.getTime()).toBe(resetAt * 1000);
  });

  it('maps a bare 403 to a permission error', async () => {
    server.use(http.delete(`${API}/repos/octocat/demo`, () => permissionDeniedResponse()));

    const error = await provider()
      .deleteRepo('octocat', 'demo')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(PermissionError);
    expect(error).not.toBeInstanceOf(SecondaryRateLimitError);
  });

  it('maps 401 to an invalid token', async () => {
    server.use(
      http.get(
        `${API}/user`,
        () => new HttpResponse('{"message":"Bad credentials"}', { status: 401 }),
      ),
    );

    const error = await provider()
      .getViewer()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TokenInvalidError);
  });

  it('returns null rather than throwing when a repository is gone', async () => {
    server.use(
      http.get(`${API}/repos/octocat/ghost`, () => new HttpResponse('{}', { status: 404 })),
    );

    await expect(provider().getRepo('octocat', 'ghost')).resolves.toBeNull();
  });
});

describe('path safety', () => {
  it('refuses a repository name that could escape its path segment', async () => {
    await expect(provider().getRepo('octocat', '../../admin')).rejects.toThrow(
      /Invalid repository name/,
    );
    await expect(provider().deleteRepo('octocat', 'a/b')).rejects.toThrow(
      /Invalid repository name/,
    );
  });
});
