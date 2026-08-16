#!/usr/bin/env node
/**
 * reporeaper executable.
 *
 * Phase 1 ships only the entry point; the commander/Ink surface lands in phase 4.
 */
import { readFileSync } from 'node:fs';

function version(): string {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version: string }).version;
}

process.stdout.write(`reporeaper ${version()}\n`);
