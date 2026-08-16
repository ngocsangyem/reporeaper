import { http, HttpResponse } from 'msw';

/**
 * Shared GitHub API fixtures.
 *
 * Kept in one place because the proxy, the CLI, and the core tests all need the
 * same awkward shapes — Link-header pagination and the three different meanings
 * of a 403 — and each hand-rolling them is how the classifications drift apart.
 */

export const API = 'https://api.github.com';

export interface RepoOverrides {
  id?: number;
  name?: string;
  login?: string;
  ownerType?: string;
  description?: string | null;
  fork?: boolean;
  forksCount?: number;
  archived?: boolean;
  admin?: boolean;
  isPrivate?: boolean;
}

/** Builds a GitHub repository payload with sensible defaults. */
export function repoPayload(overrides: RepoOverrides = {}) {
  const name = overrides.name ?? 'demo';
  const login = overrides.login ?? 'octocat';

  return {
    id: overrides.id ?? 1,
    name,
    full_name: `${login}/${name}`,
    owner: { login, type: overrides.ownerType ?? 'User' },
    description: overrides.description === undefined ? 'A demo repo' : overrides.description,
    private: overrides.isPrivate ?? false,
    fork: overrides.fork ?? false,
    forks_count: overrides.forksCount ?? 0,
    archived: overrides.archived ?? false,
    html_url: `https://github.com/${login}/${name}`,
    updated_at: '2026-01-01T00:00:00Z',
    permissions: { admin: overrides.admin ?? true, push: true, pull: true },
  };
}

/** `GET /user` for an account owning `publicRepos` + `privateRepos`. */
export function viewerHandler(
  options: {
    login?: string;
    publicRepos?: number;
    privateRepos?: number;
    /** Fine-grained tokens frequently omit the counts entirely. */
    omitCounts?: boolean;
  } = {},
) {
  const login = options.login ?? 'octocat';
  return http.get(`${API}/user`, () =>
    HttpResponse.json(
      options.omitCounts
        ? { login }
        : {
            login,
            public_repos: options.publicRepos ?? 1,
            total_private_repos: options.privateRepos ?? 0,
          },
    ),
  );
}

/**
 * `GET /user/repos` paginated across `pages`, wired with the Link headers a
 * real multi-page account returns.
 */
export function paginatedReposHandler(pages: Array<ReturnType<typeof repoPayload>[]>) {
  return http.get(`${API}/user/repos`, ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const body = pages[page - 1] ?? [];
    const hasNext = page < pages.length;

    return HttpResponse.json(body, {
      headers: hasNext
        ? {
            link: `<${API}/user/repos?affiliation=owner&per_page=100&page=${page + 1}>; rel="next", <${API}/user/repos?affiliation=owner&per_page=100&page=${pages.length}>; rel="last"`,
          }
        : {},
    });
  });
}

/**
 * A secondary-rate-limit 403.
 *
 * The distinguishing detail: `retry-after` is present and the quota headers say
 * nothing is exhausted. Keying rate-limit detection on `x-ratelimit-remaining`
 * therefore misreads this as a permission failure.
 */
export function secondaryRateLimitResponse(retryAfterSeconds = 42) {
  return new HttpResponse(
    JSON.stringify({
      message:
        'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.',
    }),
    {
      status: 403,
      headers: {
        'retry-after': String(retryAfterSeconds),
        'x-ratelimit-remaining': '4999',
        'content-type': 'application/json',
      },
    },
  );
}

/** A primary-quota-exhausted 403. */
export function primaryRateLimitResponse(resetEpochSeconds: number) {
  return new HttpResponse(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpochSeconds),
      'content-type': 'application/json',
    },
  });
}

/** A plain permission 403, with no rate-limit signals at all. */
export function permissionDeniedResponse() {
  return new HttpResponse(JSON.stringify({ message: 'Must have admin rights to Repository.' }), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  });
}
