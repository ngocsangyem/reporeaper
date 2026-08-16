/** Core domain types shared by the CLI, the TUI, the proxy, and the web SPA. */

/** Owner of a repository. v1 acts on personal repos only, so `type` is checked. */
export interface RepoOwner {
  login: string;
  type: 'User' | 'Organization';
}

/**
 * A repository as RepoReaper needs it.
 *
 * `id` is the identity that matters: selection, verification, and every mutation
 * key off it. Names are reusable on GitHub, so acting on a name alone can hit a
 * different repository than the one the user selected.
 */
export interface Repo {
  id: number;
  name: string;
  fullName: string;
  owner: RepoOwner;
  description: string | null;
  private: boolean;
  /** A fork's deletion is not restorable, so the confirm step warns differently. */
  fork: boolean;
  forksCount: number;
  archived: boolean;
  htmlUrl: string;
  updatedAt: string;
  /** Without `admin`, delete and archive will fail — surface it before confirm. */
  permissions: RepoPermissions;
}

export interface RepoPermissions {
  admin: boolean;
  push: boolean;
  pull: boolean;
}

/**
 * The minimum needed to act on a repository: which one, and where it lives.
 *
 * Actions take this rather than a full `Repo` because the web client only sends
 * an identifier — building a fake `Repo` around it to satisfy a type would
 * invent fields nobody verified.
 */
export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

/** Narrows a full repository to the reference an action needs. */
export function toRepoRef(repo: Repo): RepoRef {
  return { id: repo.id, owner: repo.owner.login, name: repo.name };
}

/** The two destructive operations v1 supports. Archive is the reversible one. */
export type RepoAction = 'delete' | 'archive';

/**
 * What happened to one repository.
 *
 * `already-gone` is a success: a delete that 404s on retry means the earlier
 * attempt landed. `changed-since-listing` is a refusal, not a failure — the
 * live repository did not match the selected one, so nothing was touched.
 */
export type ActionOutcome = 'ok' | 'already-gone' | 'changed-since-listing' | 'failed';

export interface ActionResult {
  repo: RepoRef;
  action: RepoAction;
  ok: boolean;
  outcome: ActionOutcome;
  /** Machine-readable error class name, when the action did not succeed. */
  code?: string;
  /** Human-readable, already sanitized for display. */
  error?: string;
}

/** The authenticated user, plus what their token can actually see. */
export interface Viewer {
  login: string;
  tokenKind: TokenKind;
  /**
   * Repositories the account owns according to `GET /user`. Fine-grained tokens
   * may omit the private count, so this can be undefined — in which case a
   * "token sees N of M" warning cannot be computed and must not be invented.
   */
  accountTotal?: number;
}

export type TokenKind = 'classic' | 'fine-grained' | 'unknown';

/** Result of listing every repository the token can see. */
export interface RepoListing {
  repos: Repo[];
  visibility: RepoVisibilitySummary;
}

/**
 * Whether the listing is plausibly complete.
 *
 * A fine-grained token scoped to a subset of repositories returns a full-looking
 * page with no indication that anything is missing. Comparing `seen` against the
 * account total is the only signal available.
 */
export interface RepoVisibilitySummary {
  tokenKind: TokenKind;
  seen: number;
  accountTotal?: number;
  /** True when the token demonstrably sees fewer repos than the account owns. */
  partial: boolean;
}
