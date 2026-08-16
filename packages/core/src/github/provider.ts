import { classifyResponse, NotFoundError } from '../errors.js';
import type { Provider } from '../provider.js';
import { sanitizeDisplay } from '../sanitize.js';
import type { GitHubToken } from '../token.js';
import type { Repo, RepoListing, TokenKind, Viewer } from '../types.js';
import { encodePathSegment, GitHubClient } from './client.js';
import { parseNextLink, toApiPath } from './pagination.js';

/** Shape of the fields this app reads from GitHub's repository payload. */
interface GitHubRepoPayload {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; type: string };
  description: string | null;
  private: boolean;
  fork: boolean;
  forks_count: number;
  archived: boolean;
  html_url: string;
  updated_at: string;
  permissions?: { admin?: boolean; push?: boolean; pull?: boolean };
}

interface GitHubUserPayload {
  login: string;
  public_repos?: number;
  total_private_repos?: number;
}

const PER_PAGE = 100;

/**
 * Guard against an unbounded walk if a Link header ever cycles. 200 pages is
 * 20,000 repositories — far past any personal account.
 */
const MAX_PAGES = 200;

/** Maps GitHub's payload to the internal shape, sanitizing display strings. */
function toRepo(payload: GitHubRepoPayload): Repo {
  return {
    id: payload.id,
    name: payload.name,
    fullName: payload.full_name,
    owner: {
      login: payload.owner.login,
      type: payload.owner.type === 'User' ? 'User' : 'Organization',
    },
    description: payload.description === null ? null : sanitizeDisplay(payload.description),
    private: payload.private,
    fork: payload.fork,
    forksCount: payload.forks_count,
    archived: payload.archived,
    htmlUrl: payload.html_url,
    updatedAt: payload.updated_at,
    permissions: {
      admin: payload.permissions?.admin ?? false,
      push: payload.permissions?.push ?? false,
      pull: payload.permissions?.pull ?? false,
    },
  };
}

export class GitHubProvider implements Provider {
  readonly #client: GitHubClient;
  readonly #tokenKind: TokenKind;

  constructor(token: GitHubToken, client?: GitHubClient) {
    this.#client = client ?? new GitHubClient(token);
    this.#tokenKind = token.kind;
  }

  async getViewer(): Promise<Viewer> {
    const user = await this.#client.requestJson<GitHubUserPayload>(
      '/user',
      'Reading the authenticated user',
    );

    // A fine-grained token often cannot see the private count. Adding an absent
    // number as zero would understate the account total and produce a bogus
    // "your token sees everything" conclusion, so it stays undefined.
    const accountTotal =
      user.public_repos === undefined && user.total_private_repos === undefined
        ? undefined
        : (user.public_repos ?? 0) + (user.total_private_repos ?? 0);

    return { login: user.login, tokenKind: this.#tokenKind, accountTotal };
  }

  async listAllRepos(): Promise<RepoListing> {
    const viewer = await this.getViewer();
    const repos: Repo[] = [];

    // `affiliation=owner` must not be combined with `type`; GitHub 422s on that
    // pairing. Sorting by name keeps the listing stable between runs.
    let path: string | null =
      `/user/repos?affiliation=owner&per_page=${PER_PAGE}&sort=full_name&direction=asc`;
    let pages = 0;

    while (path !== null && pages < MAX_PAGES) {
      const response = await this.#client.request(path);
      if (!response.ok) {
        throw classifyResponse(
          response.status,
          response.headers,
          await response.text(),
          'Listing repositories',
        );
      }

      const page = (await response.json()) as GitHubRepoPayload[];
      repos.push(...page.map(toRepo));

      const next = parseNextLink(response.headers.get('link'));
      path = next === null ? null : toApiPath(next);
      pages += 1;
    }

    const seen = repos.length;
    return {
      repos,
      visibility: {
        tokenKind: viewer.tokenKind,
        seen,
        accountTotal: viewer.accountTotal,
        partial: viewer.accountTotal !== undefined && seen < viewer.accountTotal,
      },
    };
  }

  async getRepo(owner: string, name: string): Promise<Repo | null> {
    const path = `/repos/${encodePathSegment(owner, 'owner')}/${encodePathSegment(name, 'repository name')}`;
    try {
      return toRepo(
        await this.#client.requestJson<GitHubRepoPayload>(path, `Reading ${owner}/${name}`),
      );
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  async deleteRepo(owner: string, name: string): Promise<void> {
    const path = `/repos/${encodePathSegment(owner, 'owner')}/${encodePathSegment(name, 'repository name')}`;
    const response = await this.#client.request(path, { method: 'DELETE' });

    if (!response.ok) {
      throw classifyResponse(
        response.status,
        response.headers,
        await response.text(),
        `Deleting ${owner}/${name}`,
      );
    }
  }

  async archiveRepo(owner: string, name: string): Promise<Repo> {
    const path = `/repos/${encodePathSegment(owner, 'owner')}/${encodePathSegment(name, 'repository name')}`;
    return toRepo(
      await this.#client.requestJson<GitHubRepoPayload>(path, `Archiving ${owner}/${name}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      }),
    );
  }
}
