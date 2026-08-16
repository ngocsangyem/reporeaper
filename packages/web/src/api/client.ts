import type { ActionResult, RepoAction, RepoListing } from '@reporeaper/core';

/**
 * The SPA's own thin client for the RPC proxy.
 *
 * Deliberately NOT core's GitHub client: this talks to `/api/*`, three named
 * operations, and has no idea what a GitHub URL looks like. Keeping the browser
 * unable to address GitHub directly is what stops the proxy from being usable
 * as a credential relay.
 */

export interface MeResponse {
  mode: 'local' | 'byo';
  tokenState: 'absent' | 'invalid' | 'ok';
  login?: string;
  tokenType?: 'classic' | 'fine-grained' | 'unknown';
  message?: string;
}

/** Thrown when the proxy reports the token is missing or no longer valid. */
export class UnauthenticatedError extends Error {
  readonly tokenState: 'absent' | 'invalid';

  constructor(tokenState: 'absent' | 'invalid') {
    super(tokenState === 'absent' ? 'No token supplied.' : 'The token was rejected.');
    this.name = 'UnauthenticatedError';
    this.tokenState = tokenState;
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * The session token from the launch URL.
 *
 * `reporeaper ui` prints it in the URL; the local proxy refuses any request
 * without it, which is what stops a random page in another tab from driving
 * the localhost API.
 */
function sessionTokenFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('s');
}

export interface ClientOptions {
  /** Reads the in-memory token. A function, so the client never stores it. */
  getToken: () => string | null;
  /** Invoked when the proxy reports the token is absent or invalid. */
  onUnauthenticated?: (state: 'absent' | 'invalid') => void;
  baseUrl?: string;
}

export class ApiClient {
  readonly #getToken: () => string | null;
  readonly #onUnauthenticated: ((state: 'absent' | 'invalid') => void) | undefined;
  readonly #baseUrl: string;
  readonly #sessionToken: string | null;

  constructor(options: ClientOptions) {
    this.#getToken = options.getToken;
    this.#onUnauthenticated = options.onUnauthenticated;
    this.#baseUrl = options.baseUrl ?? '';
    this.#sessionToken = sessionTokenFromUrl();
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const token = this.#getToken();
    if (token) headers.set('x-github-token', token);
    if (this.#sessionToken) headers.set('x-session-token', this.#sessionToken);

    const response = await fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers,
      // No cookies are involved anywhere in this design; sending them would only
      // widen what a cross-site request could accomplish.
      credentials: 'omit',
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    // One interceptor for the whole app: a token that expires mid-session
    // surfaces the gate again instead of a wall of failed rows.
    if (response.status === 401 || response.status === 403) {
      const state = response.status === 401 ? 'absent' : 'invalid';
      const isAuthProblem =
        body.error === 'token_absent' ||
        body.tokenState === 'absent' ||
        body.tokenState === 'invalid' ||
        body.error === 'token-invalid';

      if (isAuthProblem) {
        this.#onUnauthenticated?.(state);
        throw new UnauthenticatedError(state);
      }
    }

    if (!response.ok) {
      throw new ApiError(
        response.status,
        typeof body.error === 'string' ? body.error : 'unexpected',
        typeof body.message === 'string' ? body.message : 'The request failed.',
      );
    }

    return body as T;
  }

  /** Authentication state. Never throws for an unauthenticated answer. */
  async me(): Promise<MeResponse> {
    const headers = new Headers();
    const token = this.#getToken();
    if (token) headers.set('x-github-token', token);
    if (this.#sessionToken) headers.set('x-session-token', this.#sessionToken);

    const response = await fetch(`${this.#baseUrl}/api/me`, { headers, credentials: 'omit' });
    return (await response.json()) as MeResponse;
  }

  listRepos(): Promise<RepoListing> {
    return this.#request<RepoListing>('/api/repos');
  }

  /** Acts on exactly one repository. The batch loop lives in the client. */
  act(
    action: RepoAction,
    repo: { id: number; owner: string; name: string },
  ): Promise<ActionResult> {
    return this.#request<ActionResult>('/api/actions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, repo }),
    });
  }
}
