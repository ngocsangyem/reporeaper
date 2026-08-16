/**
 * Vercel serverless entry for the self-hosted RPC proxy.
 *
 * This file depends on @reporeaper/core ONLY — never on the cli package — so the
 * function never pulls Ink, React, or commander into its bundle. Phase 3 swaps
 * the placeholder response for `createProxyApp` from core.
 */
import { CORE_PACKAGE_NAME } from '@reporeaper/core';

export const config = { runtime: 'edge' };

export default function handler(_request: Request): Response {
  return new Response(
    JSON.stringify({
      error: 'not_implemented',
      message: `RPC proxy lands in phase 3 (backed by ${CORE_PACKAGE_NAME}).`,
    }),
    { status: 501, headers: { 'content-type': 'application/json' } },
  );
}
