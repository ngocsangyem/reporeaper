import type { Repo, RepoListing, Viewer } from './types.js';

/**
 * The provider seam.
 *
 * GitHub is the only implementation in v1. The interface exists so a GitLab
 * implementation can be added without the CLI, TUI, and web UI each learning a
 * second API shape — everything above this line works in terms of `Repo`.
 */
export interface Provider {
  /** The authenticated account, and what the token can see. */
  getViewer(): Promise<Viewer>;

  /** Every repository owned by the authenticated user, paginated to exhaustion. */
  listAllRepos(): Promise<RepoListing>;

  /** Re-reads one repository. Returns null when it no longer exists. */
  getRepo(owner: string, name: string): Promise<Repo | null>;

  /** Permanently deletes one repository. */
  deleteRepo(owner: string, name: string): Promise<void>;

  /** Marks one repository archived (read-only) and returns its new state. */
  archiveRepo(owner: string, name: string): Promise<Repo>;
}
