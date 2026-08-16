import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { runAction } from '../actions.js';
import { PermissionError, ProviderError, TokenInvalidError } from '../errors.js';
import { GitHubProvider } from '../github/provider.js';
import type { Provider } from '../provider.js';
import { GitHubToken } from '../token.js';
import type { RepoAction } from '../types.js';

/**
 * The RPC surface the web UI talks to.
 *
 * This is an allow-list of three named operations, not a GitHub passthrough.
 * The distinction is the entire security model: a proxy that forwards a
 * client-supplied path attaches the user's token to whatever the client asks
 * for, which makes every server-side guardrail — owner checks, id verification,
 * personal-repos-only — trivially bypassable by calling GitHub directly through
 * it. No route here builds a GitHub path out of client input.
 *
 * Nothing in this file logs a request, a header, or a body. That is a
 * deliberate constraint, enforced by the scoped no-console lint rule and the
 * runtime sentinel harness rather than by good intentions.
 */

/**
 * `/api/actions` body. `.strict()` rejects unknown fields, and the shape admits
 * exactly one repository — the client drives the batch loop one call at a time,
 * so a partially-completed batch always has an exact record.
 */
const actionRequestSchema = z
  .object({
    action: z.enum(['delete', 'archive']),
    repo: z
      .object({
        id: z.number().int().positive(),
        // Charset-gated here as well as in the client, because this boundary
        // cannot assume the caller is our own SPA.
        owner: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
        name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/),
      })
      .strict(),
  })
  .strict();

export type ProxyMode = 'local' | 'byo';

export interface ProxyOptions {
  /**
   * True when the listener is bound to loopback. Gates both the ambient env
   * token and the local request hardening.
   */
  isLoopback: boolean;
  /** Server-side token. Honored only in loopback mode. */
  envToken?: string | null;
  /** Per-process secret echoed by the SPA; required in loopback mode. */
  sessionToken?: string;
  /** Port the local listener is bound to, for the Host check. */
  port?: number;
  /** Required to run a publicly reachable instance that has an env token. */
  accessPassword?: string | null;
  /** Injectable for tests; production builds a GitHubProvider. */
  createProvider?: (token: GitHubToken) => Provider;
}

interface RequestState {
  provider: Provider;
  mode: ProxyMode;
}

/** Constant-time string comparison, so a secret cannot be guessed byte by byte. */
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Accepts only loopback hosts, on the port actually being served. */
function isAllowedLocalHost(host: string | undefined, port: number | undefined): boolean {
  if (!host) return false;
  const allowed = new Set(
    port === undefined
      ? ['127.0.0.1', 'localhost', '[::1]']
      : [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
  );
  return allowed.has(host.toLowerCase());
}

export function createProxyApp(options: ProxyOptions) {
  // Refuse to build a loopback app without a session secret rather than
  // silently skipping the check. This is exported API: a caller who forgets the
  // field would otherwise get a server that performs deletes for any local
  // process, and nothing would say so.
  if (options.isLoopback && !options.sessionToken) {
    throw new Error('createProxyApp requires a sessionToken when isLoopback is true.');
  }

  const app = new Hono<{ Variables: RequestState }>();

  /**
   * A publicly reachable instance holding an ambient token is an unauthenticated
   * repository-deletion service for anyone who finds the URL. Refuse to serve
   * rather than quietly ignoring the token, so the operator notices the
   * misconfiguration instead of shipping it.
   */
  app.use('/api/*', async (context, next) => {
    if (!options.isLoopback && options.envToken && !options.accessPassword) {
      return context.json(
        {
          error: 'unsafe_configuration',
          message:
            'This instance is publicly reachable and has a server-side GITHUB_TOKEN. ' +
            'Set REPOREAPER_ACCESS_PASSWORD, or remove the token and use paste-only mode.',
        },
        503,
      );
    }
    return next();
  });

  /**
   * Local hardening. A page on any origin can make a simple cross-site request
   * to 127.0.0.1 while `reporeaper ui` is open, and DNS rebinding defeats an
   * origin check alone — so the Host header, the fetch metadata, and a
   * per-process session secret are all required.
   */
  app.use('/api/*', async (context, next) => {
    if (!options.isLoopback) return next();

    if (!isAllowedLocalHost(context.req.header('host'), options.port)) {
      return context.json({ error: 'forbidden_host' }, 403);
    }

    const fetchSite = context.req.header('sec-fetch-site');
    if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return context.json({ error: 'cross_site_request_refused' }, 403);
    }

    const expected = options.sessionToken ?? '';
    const presented = context.req.header('x-session-token') ?? '';
    if (!secretsMatch(presented, expected)) {
      return context.json({ error: 'invalid_session_token' }, 403);
    }

    return next();
  });

  /** Access password for a deliberately public self-hosted instance. */
  app.use('/api/*', async (context, next) => {
    if (options.isLoopback || !options.accessPassword) return next();

    const presented = context.req.header('x-access-password') ?? '';
    if (!secretsMatch(presented, options.accessPassword)) {
      return context.json({ error: 'invalid_access_password' }, 401);
    }
    return next();
  });

  /**
   * Resolves the token for this request.
   *
   * A pasted header always wins, so a self-hosted instance serves each visitor
   * with their own credentials. The ambient env token is honored only on
   * loopback, where the only possible caller is the person running the process.
   */
  const resolveToken = (
    headerToken: string | undefined,
  ): { token: GitHubToken; mode: ProxyMode } | null => {
    if (headerToken && headerToken.trim().length > 0) {
      return { token: new GitHubToken(headerToken), mode: 'byo' };
    }
    if (options.isLoopback && options.envToken && options.envToken.trim().length > 0) {
      return { token: new GitHubToken(options.envToken), mode: 'local' };
    }
    return null;
  };

  const buildProvider = (token: GitHubToken): Provider =>
    options.createProvider ? options.createProvider(token) : new GitHubProvider(token);

  /**
   * Reports authentication state without overloading the status code for mode
   * detection: absent and invalid are genuinely different problems, and a UI
   * that conflates them tells a user to re-issue a token they never supplied.
   */
  app.get('/api/me', async (context) => {
    const resolved = resolveToken(context.req.header('x-github-token'));
    const mode: ProxyMode = options.isLoopback && options.envToken ? 'local' : 'byo';

    if (resolved === null) {
      return context.json({ mode, tokenState: 'absent' as const }, 401);
    }

    try {
      const viewer = await buildProvider(resolved.token).getViewer();
      return context.json({
        mode: resolved.mode,
        tokenState: 'ok' as const,
        login: viewer.login,
        tokenType: viewer.tokenKind,
      });
    } catch (error) {
      if (error instanceof TokenInvalidError) {
        return context.json({ mode, tokenState: 'invalid' as const }, 403);
      }
      // Anything else — GitHub unreachable, a 500, a rate limit on /user — is
      // not a verdict on the token. Reporting it as "rejected" would send the
      // user off to revoke and re-mint a credential that works fine, which is
      // the same conflation this route exists to avoid, one category over.
      return context.json(
        { mode, tokenState: 'unreachable' as const, message: toSafeMessage(error) },
        503,
      );
    }
  });

  /** Attaches a provider to every route that needs one. */
  const tokenGuard: MiddlewareHandler<{ Variables: RequestState }> = async (context, next) => {
    const resolved = resolveToken(context.req.header('x-github-token'));
    if (resolved === null) {
      return context.json({ error: 'token_absent' }, 401);
    }
    context.set('provider', buildProvider(resolved.token));
    context.set('mode', resolved.mode);
    return next();
  };

  app.use('/api/repos', tokenGuard);
  app.use('/api/actions', tokenGuard);

  app.get('/api/repos', async (context) => {
    try {
      return context.json(await context.get('provider').listAllRepos());
    } catch (error) {
      return context.json(
        { error: errorCode(error), message: toSafeMessage(error) },
        statusFor(error),
      );
    }
  });

  app.post('/api/actions', async (context) => {
    let body: unknown;
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: 'invalid_json' }, 400);
    }

    const parsed = actionRequestSchema.safeParse(body);
    if (!parsed.success) {
      // The validation detail is intentionally coarse: echoing the parsed body
      // back would reflect whatever the caller sent into the response.
      return context.json({ error: 'invalid_request' }, 400);
    }

    const provider = context.get('provider');

    try {
      // The server re-derives the authenticated login rather than trusting a
      // client-supplied owner, so the ownership check cannot be spoofed.
      const viewer = await provider.getViewer();
      const result = await runAction(provider, parsed.data.repo, parsed.data.action as RepoAction, {
        authenticatedLogin: viewer.login,
      });

      // A refusal is a 403: nothing was forwarded to GitHub.
      return context.json(result, result.outcome === 'changed-since-listing' ? 403 : 200);
    } catch (error) {
      return context.json(
        { error: errorCode(error), message: toSafeMessage(error) },
        statusFor(error),
      );
    }
  });

  return app;
}

/** Error text safe to return: our own messages only, never a raw upstream body. */
function toSafeMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message;
  return 'The request could not be completed.';
}

function errorCode(error: unknown): string {
  return error instanceof ProviderError ? error.code : 'unexpected';
}

function statusFor(error: unknown): 401 | 403 | 404 | 429 | 500 {
  if (error instanceof TokenInvalidError) return 403;
  if (error instanceof PermissionError) return 403;
  if (!(error instanceof ProviderError)) return 500;
  if (error.status === 404) return 404;
  if (error.code === 'secondary-rate-limit' || error.code === 'primary-rate-limit') return 429;
  if (error.status === 401) return 401;
  return 500;
}
