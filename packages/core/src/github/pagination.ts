/**
 * Link-header pagination.
 *
 * GitHub caps `per_page` at 100, so any account with more repositories than that
 * needs the walk. Trusting a single page is the quiet failure mode here: the
 * user sees a plausible list that is simply missing everything after the first
 * hundred.
 */

/** Extracts the `rel="next"` URL from a Link header, if there is one. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;

  for (const part of linkHeader.split(',')) {
    const match = /<([^>]+)>\s*;\s*rel="([^"]+)"/.exec(part.trim());
    if (match && match[2] === 'next' && match[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Converts an absolute GitHub URL back into an API path plus query.
 *
 * The next-page URL comes back absolute, but the client only accepts paths — it
 * refuses to be pointed at another host, and following a Link header blindly
 * would be exactly that.
 */
export function toApiPath(absoluteUrl: string): string {
  const url = new URL(absoluteUrl);
  return `${url.pathname}${url.search}`;
}
