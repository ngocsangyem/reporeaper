import { GitHubProvider, GitHubToken } from '@reporeaper/core';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runBatch } from '../batch-runner.js';

/**
 * Cross-package integration: the real CLI batch runner over the real core
 * provider, with GitHub itself simulated.
 *
 * The two scenarios here are the ones the design exists for and the ones a unit
 * test with a stubbed provider cannot prove, because they depend on what the
 * HTTP layer returns between the listing and the mutation.
 */

const API = 'https://api.github.com';
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function repoPayload(id: number, name: string) {
  return {
    id,
    name,
    full_name: `octocat/${name}`,
    owner: { login: 'octocat', type: 'User' },
    description: null,
    private: false,
    fork: false,
    forks_count: 0,
    archived: false,
    html_url: `https://github.com/octocat/${name}`,
    updated_at: '2026-01-01T00:00:00Z',
    permissions: { admin: true, push: true, pull: true },
  };
}

function provider(): GitHubProvider {
  return new GitHubProvider(new GitHubToken('ghp_integration00000000000000000000'));
}

const options = { authenticatedLogin: 'octocat', sleep: () => Promise.resolve() };

describe('name reuse between listing and action', () => {
  it('refuses the repository whose id changed, and still processes the others', async () => {
    const deleted: string[] = [];

    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json({ login: 'octocat', public_repos: 3, total_private_repos: 0 }),
      ),
      http.get(`${API}/user/repos`, () =>
        HttpResponse.json([
          repoPayload(1, 'keep-me'),
          repoPayload(2, 'renamed-away'),
          repoPayload(3, 'also-fine'),
        ]),
      ),
      // The middle repository's name now resolves to a different repository —
      // the original was renamed and something else claimed the name.
      http.get(`${API}/repos/octocat/renamed-away`, () =>
        HttpResponse.json(repoPayload(999, 'renamed-away')),
      ),
      http.get(`${API}/repos/octocat/:name`, ({ params }) => {
        const name = String(params.name);
        const id = name === 'keep-me' ? 1 : 3;
        return HttpResponse.json(repoPayload(id, name));
      }),
      http.delete(`${API}/repos/octocat/:name`, ({ params }) => {
        deleted.push(String(params.name));
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const listing = await provider().listAllRepos();
    const summary = await runBatch(provider(), listing.repos, 'delete', options);

    // The impostor is never touched, and the run does not abort because of it.
    expect(deleted).toEqual(['keep-me', 'also-fine']);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]?.outcome).toBe('changed-since-listing');
    expect(summary.succeeded).toHaveLength(2);
  });
});

describe('interrupted batch', () => {
  it('reports exactly the repositories that completed before the failure', async () => {
    const deleted: string[] = [];
    const seen: string[] = [];

    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json({ login: 'octocat', public_repos: 4, total_private_repos: 0 }),
      ),
      http.get(`${API}/user/repos`, () =>
        HttpResponse.json([
          repoPayload(1, 'first'),
          repoPayload(2, 'second'),
          repoPayload(3, 'network-dies-here'),
          repoPayload(4, 'fourth'),
        ]),
      ),
      http.get(`${API}/repos/octocat/:name`, ({ params }) => {
        const name = String(params.name);
        const id = { first: 1, second: 2, 'network-dies-here': 3, fourth: 4 }[name] ?? 0;
        return HttpResponse.json(repoPayload(id, name));
      }),
      http.delete(`${API}/repos/octocat/:name`, ({ params }) => {
        const name = String(params.name);
        // Simulate the connection dropping partway through the batch.
        if (name === 'network-dies-here') return HttpResponse.error();
        deleted.push(name);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const listing = await provider().listAllRepos();
    const summary = await runBatch(provider(), listing.repos, 'delete', {
      ...options,
      onResult: (result) => seen.push(result.repo.name),
    });

    // Every repository has a recorded outcome — the failure does not erase the
    // record of what already happened, and the run continues past it.
    expect(seen).toEqual(['first', 'second', 'network-dies-here', 'fourth']);
    expect(deleted).toEqual(['first', 'second', 'fourth']);
    expect(summary.remaining.map((repo) => repo.name)).toEqual(['network-dies-here']);
  });

  it('reports a repository it cannot see as unresolved rather than as deleted', async () => {
    server.use(
      http.get(`${API}/user`, () =>
        HttpResponse.json({ login: 'octocat', public_repos: 1, total_private_repos: 0 }),
      ),
      http.get(`${API}/repos/octocat/already-deleted`, () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
    );

    const summary = await runBatch(
      provider(),
      [
        {
          id: 7,
          name: 'already-deleted',
          fullName: 'octocat/already-deleted',
          owner: { login: 'octocat', type: 'User' },
          description: null,
          private: false,
          fork: false,
          forksCount: 0,
          archived: false,
          htmlUrl: '',
          updatedAt: '2026-01-01T00:00:00Z',
          permissions: { admin: true, push: true, pull: true },
        },
      ],
      'delete',
      options,
    );

    // GitHub answers 404 both for "deleted" and for "your token lost access",
    // so this stays in the retry set instead of being reported as done.
    expect(summary.succeeded).toHaveLength(0);
    expect(summary.failed[0]?.code).toBe('not-visible');
    expect(summary.remaining).toHaveLength(1);
  });
});
