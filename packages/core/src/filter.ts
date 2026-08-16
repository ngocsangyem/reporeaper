import type { Repo } from './types.js';

/**
 * Client-side substring search over the already-fetched list.
 *
 * Substring, not fuzzy: this list is the input to a delete confirmation, and
 * fuzzy matching surfaces repositories the user did not mean, which is exactly
 * the wrong error to make here. It is also why the GitHub Search API is not
 * used — its index lags, so it happily returns repositories that were just
 * deleted.
 */
export function filterRepos(repos: Repo[], query: string): Repo[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return repos;

  return repos.filter((repo) => {
    if (repo.name.toLowerCase().includes(needle)) return true;
    return repo.description !== null && repo.description.toLowerCase().includes(needle);
  });
}
