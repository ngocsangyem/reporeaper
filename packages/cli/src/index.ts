/**
 * reporeaper — programmatic entry point.
 *
 * This module must stay side-effect free: the token-hygiene harness imports it
 * with a sentinel token in the environment and asserts nothing is written to
 * stdout or stderr. The executable behaviour lives in `bin.ts`.
 */

export const CLI_PACKAGE_NAME = 'reporeaper';
