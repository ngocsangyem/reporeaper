import { classifyResponse, ValidationError } from '../errors.js';
import type { GitHubToken } from '../token.js';

/**
 * The API base is a module constant, deliberately not a constructor option.
 *
 * Making it injectable would let a caller point this client at a proxy or an
 * attacker-controlled host and inherit the Authorization header, which is how a
 * guardrail-enforcing proxy turns into an open credential relay. The web SPA
 * therefore talks to its own `/api` client instead of reusing this one.
 */
const GITHUB_API_BASE = 'https://api.github.com';

/** GitHub repository and owner names, as accepted before any request is built. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Validates and encodes one path segment.
 *
 * Both halves matter: the charset gate rejects `..` traversal and slashes
 * outright, and encoding covers anything else that survives the gate.
 */
export function encodePathSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) {
    throw new ValidationError(`Invalid ${label}: only letters, digits, dot, dash and underscore.`);
  }
  return encodeURIComponent(value);
}

export interface GitHubClientOptions {
  /** Injectable only for tests; production always uses the global fetch. */
  fetchImpl?: typeof fetch;
}

/** Thin authenticated fetch wrapper over the GitHub REST API. */
export class GitHubClient {
  readonly #token: GitHubToken;
  readonly #fetch: typeof fetch;

  constructor(token: GitHubToken, options: GitHubClientOptions = {}) {
    this.#token = token;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Issues a request against the GitHub API.
   *
   * `path` must be an absolute API path such as `/user/repos`; it is appended to
   * the fixed base, never used to replace it.
   */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!path.startsWith('/')) {
      throw new ValidationError('API path must start with "/".');
    }

    return this.#fetch(`${GITHUB_API_BASE}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'reporeaper',
        authorization: this.#token.authorizationHeader,
        ...init.headers,
      },
    });
  }

  /**
   * Issues a request and parses JSON, mapping any failure to a typed error.
   *
   * The response body is read for classification but never attached verbatim to
   * the thrown error, so a request echo cannot carry the token into a log.
   */
  async requestJson<T>(path: string, context: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) {
      throw classifyResponse(response.status, response.headers, await response.text(), context);
    }
    return (await response.json()) as T;
  }
}
