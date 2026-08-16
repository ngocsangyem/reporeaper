/**
 * Vercel serverless entry for the self-hosted RPC proxy.
 *
 * Depends on @reporeaper/core ONLY — never on the cli package — so the function
 * never pulls Ink, React, or commander into its bundle.
 *
 * `isLoopback: false` is the important line: a deployed instance never honors an
 * ambient server-side token, because a public URL plus an ambient token is an
 * unauthenticated repository-deletion service. Visitors paste their own token,
 * which lives only in the request.
 */
import { createProxyApp } from '@reporeaper/core';

const app = createProxyApp({
  isLoopback: false,
  envToken: process.env.GITHUB_TOKEN ?? null,
  accessPassword: process.env.REPOREAPER_ACCESS_PASSWORD ?? null,
});

export default function handler(request: Request): Response | Promise<Response> {
  return app.fetch(request);
}
