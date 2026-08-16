import type { TokenKind } from './types.js';

/**
 * A GitHub token that refuses to reveal itself.
 *
 * The value lives in a true private field with **no public mirror**. That is the
 * whole design: `String()`, `JSON.stringify()`, and `util.inspect()` each have a
 * different reach, and only a private field is out of reach of all three. A
 * wrapper that also assigns `this.value = value` leaks the moment anything is
 * inspected or logged, which is how tokens end up in CI output.
 *
 * The only way out is `authorizationHeader`, used at the point of the request.
 */
export class GitHubToken {
  #value: string;

  constructor(value: string) {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error('GitHub token is empty');
    }
    this.#value = trimmed;
  }

  /** The Authorization header value. Never store or log the result. */
  get authorizationHeader(): string {
    return `Bearer ${this.#value}`;
  }

  /**
   * Classic (`ghp_`/`gho_`) versus fine-grained (`github_pat_`).
   *
   * This matters because fine-grained tokens cannot be scope-checked through
   * `x-oauth-scopes` and may silently see only a subset of repositories.
   */
  get kind(): TokenKind {
    if (this.#value.startsWith('github_pat_')) return 'fine-grained';
    if (/^gh[pousr]_/.test(this.#value)) return 'classic';
    return 'unknown';
  }

  toString(): string {
    return '[redacted]';
  }

  toJSON(): string {
    return '[redacted]';
  }

  /** Covers console.log / console.error, which use util.inspect, not toString. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return '[redacted]';
  }
}
