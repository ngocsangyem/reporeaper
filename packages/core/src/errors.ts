/**
 * Typed errors for GitHub responses.
 *
 * The distinctions here are not cosmetic. A 403 can mean "your token lacks the
 * permission" (stop and fix the token) or "you are being rate limited" (wait and
 * retry). Collapsing them tells a user to go re-issue a token when they only
 * needed to slow down.
 */

/** Base class so callers can catch everything this package throws. */
export class ProviderError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
  }
}

/** No token was supplied at all — distinct from one that was rejected. */
export class TokenMissingError extends ProviderError {
  constructor(message = 'No GitHub token was provided.') {
    super(message, 'token-missing', 401);
  }
}

/** A token was supplied and GitHub rejected it. */
export class TokenInvalidError extends ProviderError {
  constructor(message = 'GitHub rejected the token. It may be expired or revoked.') {
    super(message, 'token-invalid', 401);
  }
}

/** The token authenticated but is not allowed to perform this operation. */
export class PermissionError extends ProviderError {
  constructor(message: string) {
    super(message, 'permission-denied', 403);
  }
}

export class NotFoundError extends ProviderError {
  constructor(message = 'Repository not found.') {
    super(message, 'not-found', 404);
  }
}

export class ValidationError extends ProviderError {
  constructor(message: string) {
    super(message, 'validation-failed', 422);
  }
}

/**
 * GitHub's secondary rate limit: triggered by making mutations too quickly.
 *
 * It arrives as a 403 (sometimes 429) and is NOT accompanied by
 * `x-ratelimit-remaining: 0`, which is why keying rate-limit detection on that
 * header misclassifies it as a permission failure.
 */
export class SecondaryRateLimitError extends ProviderError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, message = 'GitHub secondary rate limit hit.') {
    super(message, 'secondary-rate-limit', 403);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** The hourly quota is exhausted; `resetAt` says when it refills. */
export class PrimaryRateLimitError extends ProviderError {
  readonly resetAt: Date;

  constructor(resetAt: Date, message = 'GitHub API rate limit exhausted.') {
    super(message, 'primary-rate-limit', 403);
    this.resetAt = resetAt;
  }
}

export class UnexpectedResponseError extends ProviderError {
  constructor(status: number, message: string) {
    super(message, 'unexpected-response', status);
  }
}

/** Reads `retry-after`, which may be seconds or an HTTP date. */
function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);

  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/**
 * Maps a failed response to a typed error.
 *
 * Order matters: secondary rate limiting is checked before the generic 403 path,
 * and before the primary-limit header check, because a secondary limit does not
 * set the remaining-quota header.
 */
export function classifyResponse(
  status: number,
  headers: Headers,
  body: string,
  context: string,
): ProviderError {
  const retryAfter = parseRetryAfter(headers);
  const mentionsSecondaryLimit = /secondary rate limit/i.test(body);

  if ((status === 403 || status === 429) && (retryAfter !== undefined || mentionsSecondaryLimit)) {
    return new SecondaryRateLimitError(retryAfter ?? 60);
  }

  if ((status === 403 || status === 429) && headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(headers.get('x-ratelimit-reset'));
    const resetAt = Number.isFinite(reset) ? new Date(reset * 1000) : new Date(Date.now() + 60_000);
    return new PrimaryRateLimitError(resetAt);
  }

  switch (status) {
    case 401:
      return new TokenInvalidError();
    case 403:
      return new PermissionError(
        `${context}: the token is not allowed to do this. Deleting a repository ` +
          'requires admin rights on it (a fine-grained token needs Administration: write).',
      );
    case 404:
      return new NotFoundError(`${context}: not found.`);
    case 422:
      return new ValidationError(`${context}: GitHub rejected the request as invalid.`);
    default:
      return new UnexpectedResponseError(status, `${context}: unexpected response ${status}.`);
  }
}
