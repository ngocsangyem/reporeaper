#!/usr/bin/env node
/**
 * reporeaper executable.
 *
 * Phase 1 ships only the entry point and the packaged-path resolution that the
 * global install depends on; the commander/Ink surface lands in phase 4.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolves a path inside the installed package, from `dist/` at runtime. */
export function packageRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function version(): string {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version: string }).version;
}

process.stdout.write(`reporeaper ${version()}\n`);
