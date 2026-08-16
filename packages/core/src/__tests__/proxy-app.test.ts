import { describe, expect, it, vi } from 'vitest';
import { PermissionError, TokenInvalidError } from '../errors.js';
import type { Provider } from '../provider.js';
import { createProxyApp } from '../proxy/app.js';
import type { Repo } from '../types.js';

const SESSION_TOKEN = 'session-secret-value';
const PORT = 4711;

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

function stubProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    getViewer: vi.fn().mockResolvedValue({ login: 'octocat', tokenKind: 'classic' }),
    listAllRepos: vi.fn().mockResolvedValue({
      repos: [makeRepo()],
      visibility: { tokenKind: 'classic', seen: 1, accountTotal: 1, partial: false },
    }),
    getRepo: vi.fn().mockResolvedValue(makeRepo()),
    deleteRepo: vi.fn().mockResolvedValue(undefined),
    archiveRepo: vi.fn().mockResolvedValue(makeRepo({ archived: true })),
    ...overrides,
  } as Provider;
}

/** Local-mode headers a same-origin SPA request carries. */
function localHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    host: `127.0.0.1:${PORT}`,
    'sec-fetch-site': 'same-origin',
    'x-session-token': SESSION_TOKEN,
    ...extra,
  };
}

function localApp(provider: Provider = stubProvider(), envToken: string | null = 'ghp_envtoken') {
  return createProxyApp({
    isLoopback: true,
    envToken,
    sessionToken: SESSION_TOKEN,
    port: PORT,
    createProvider: () => provider,
  });
}

describe('token resolution', () => {
  it('prefers a pasted header token over the ambient env token', async () => {
    const seenTokens: string[] = [];
    const app = createProxyApp({
      isLoopback: true,
      envToken: 'ghp_envtoken',
      sessionToken: SESSION_TOKEN,
      port: PORT,
      createProvider: (token) => {
        seenTokens.push(token.authorizationHeader);
        return stubProvider();
      },
    });

    const response = await app.request('/api/repos', {
      headers: localHeaders({ 'x-github-token': 'ghp_headertoken' }),
    });

    expect(response.status).toBe(200);
    expect(seenTokens[0]).toContain('ghp_headertoken');
    expect(seenTokens[0]).not.toContain('ghp_envtoken');
  });

  it('ignores the env token entirely when the listener is not loopback', async () => {
    // Without this, deploying with GITHUB_TOKEN set would let any visitor act
    // as the operator.
    const app = createProxyApp({
      isLoopback: false,
      envToken: 'ghp_envtoken',
      accessPassword: 'let-me-in',
      createProvider: () => stubProvider(),
    });

    const response = await app.request('/api/repos', {
      headers: { 'x-access-password': 'let-me-in' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: 'token_absent' });
  });

  it('refuses to serve a public instance that has an env token but no password', async () => {
    const app = createProxyApp({
      isLoopback: false,
      envToken: 'ghp_envtoken',
      accessPassword: null,
    });

    const response = await app.request('/api/me');

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'unsafe_configuration' });
  });
});

describe('/api/me', () => {
  it('distinguishes an absent token from an invalid one', async () => {
    const absent = createProxyApp({ isLoopback: false });
    const absentResponse = await absent.request('/api/me');
    expect(absentResponse.status).toBe(401);
    expect(await absentResponse.json()).toMatchObject({ tokenState: 'absent' });

    const invalid = createProxyApp({
      isLoopback: false,
      createProvider: () =>
        stubProvider({ getViewer: vi.fn().mockRejectedValue(new TokenInvalidError()) }),
    });
    const invalidResponse = await invalid.request('/api/me', {
      headers: { 'x-github-token': 'ghp_bad' },
    });
    expect(invalidResponse.status).toBe(403);
    expect(await invalidResponse.json()).toMatchObject({ tokenState: 'invalid' });
  });

  it('reports the login and token type when the token works', async () => {
    const response = await localApp().request('/api/me', { headers: localHeaders() });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      tokenState: 'ok',
      login: 'octocat',
      tokenType: 'classic',
    });
  });
});

describe('local request hardening', () => {
  it('rejects a request whose Host is not loopback (DNS rebinding)', async () => {
    const response = await localApp().request('/api/repos', {
      headers: localHeaders({ host: 'evil.example.com' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'forbidden_host' });
  });

  it('rejects a cross-site request', async () => {
    const response = await localApp().request('/api/repos', {
      headers: localHeaders({ 'sec-fetch-site': 'cross-site' }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'cross_site_request_refused' });
  });

  it('rejects a request without the per-process session token', async () => {
    const headers = localHeaders();
    delete headers['x-session-token'];

    const response = await localApp().request('/api/repos', { headers });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: 'invalid_session_token' });
  });
});

describe('/api/actions', () => {
  async function post(app: ReturnType<typeof localApp>, body: unknown) {
    return app.request('/api/actions', {
      method: 'POST',
      headers: { ...localHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('acts on exactly one repository', async () => {
    const provider = stubProvider();
    const response = await post(localApp(provider), {
      action: 'delete',
      repo: { id: 42, owner: 'octocat', name: 'demo' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, outcome: 'ok' });
    expect(provider.deleteRepo).toHaveBeenCalledWith('octocat', 'demo');
  });

  it('rejects a batch of repositories', async () => {
    const provider = stubProvider();
    const response = await post(localApp(provider), {
      action: 'delete',
      repo: [
        { id: 42, owner: 'octocat', name: 'demo' },
        { id: 43, owner: 'octocat', name: 'other' },
      ],
    });

    expect(response.status).toBe(400);
    expect(provider.deleteRepo).not.toHaveBeenCalled();
  });

  it('rejects unknown fields rather than ignoring them', async () => {
    const response = await post(localApp(), {
      action: 'delete',
      repo: { id: 42, owner: 'octocat', name: 'demo' },
      force: true,
    });

    expect(response.status).toBe(400);
  });

  it('rejects a repository name that could escape its path segment', async () => {
    const provider = stubProvider();
    const response = await post(localApp(provider), {
      action: 'delete',
      repo: { id: 42, owner: 'octocat', name: '../../other' },
    });

    expect(response.status).toBe(400);
    expect(provider.getRepo).not.toHaveBeenCalled();
  });

  it('refuses with 403 and forwards nothing when the live id does not match', async () => {
    const provider = stubProvider({ getRepo: vi.fn().mockResolvedValue(makeRepo({ id: 999 })) });

    const response = await post(localApp(provider), {
      action: 'delete',
      repo: { id: 42, owner: 'octocat', name: 'demo' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ outcome: 'changed-since-listing' });
    expect(provider.deleteRepo).not.toHaveBeenCalled();
  });

  it('refuses when the repository belongs to someone other than the authenticated user', async () => {
    const provider = stubProvider({
      getRepo: vi
        .fn()
        .mockResolvedValue(makeRepo({ owner: { login: 'someone-else', type: 'User' } })),
    });

    const response = await post(localApp(provider), {
      action: 'delete',
      repo: { id: 42, owner: 'someone-else', name: 'demo' },
    });

    expect(response.status).toBe(403);
    expect(provider.deleteRepo).not.toHaveBeenCalled();
  });

  it('reports a permission failure as a result, not a crash', async () => {
    const provider = stubProvider({
      deleteRepo: vi.fn().mockRejectedValue(new PermissionError('needs admin')),
    });

    const response = await post(localApp(provider), {
      action: 'delete',
      repo: { id: 42, owner: 'octocat', name: 'demo' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, code: 'permission-denied' });
  });
});

describe('route surface', () => {
  it('exposes only the three named RPC routes', async () => {
    const app = localApp();
    const headers = localHeaders();

    // A passthrough proxy would happily forward these to GitHub with the token.
    for (const path of ['/api/user/repos', '/api/repos/octocat/demo', '/api/graphql', '/api']) {
      const response = await app.request(path, { headers });
      expect(response.status, `${path} must not be routed`).toBe(404);
    }
  });
});
