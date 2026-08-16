/**
 * @reporeaper/core — shared types, GitHub client, actions, and the RPC proxy app.
 *
 * Phase 1 ships the package boundary only; the modules named in the plan
 * (types, token, github/*, actions, filter, errors, sanitize, proxy/app)
 * land in phases 2 and 3.
 */

/** Package identity, used by the token-hygiene harness to prove core loads cleanly. */
export const CORE_PACKAGE_NAME = '@reporeaper/core';
