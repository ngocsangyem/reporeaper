/**
 * @reporeaper/core — shared types, GitHub client, actions, and the RPC proxy.
 *
 * Consumed by the CLI/TUI (which run where the token is), by the serverless
 * function, and by the web SPA (types and the pure filter only — the SPA never
 * holds a GitHub client).
 */

export const CORE_PACKAGE_NAME = '@reporeaper/core';

export { DEFAULT_PACE_MS, pace, runAction, type RunActionOptions } from './actions.js';
export {
  classifyResponse,
  NotFoundError,
  PermissionError,
  PrimaryRateLimitError,
  ProviderError,
  SecondaryRateLimitError,
  TokenInvalidError,
  TokenMissingError,
  UnexpectedResponseError,
  ValidationError,
} from './errors.js';
export { filterRepos } from './filter.js';
export { encodePathSegment, GitHubClient } from './github/client.js';
export { parseNextLink, toApiPath } from './github/pagination.js';
export { GitHubProvider } from './github/provider.js';
export type { Provider } from './provider.js';
export { createProxyApp, type ProxyMode, type ProxyOptions } from './proxy/app.js';
export { sanitizeDisplay } from './sanitize.js';
export { GitHubToken } from './token.js';
export { toRepoRef } from './types.js';
export type {
  ActionOutcome,
  ActionResult,
  Repo,
  RepoAction,
  RepoListing,
  RepoOwner,
  RepoPermissions,
  RepoRef,
  RepoVisibilitySummary,
  TokenKind,
  Viewer,
} from './types.js';
