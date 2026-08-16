/**
 * Placeholder web build.
 *
 * Phase 5 replaces this script with the Vite build, keeping the same output
 * directory. It exists now so the cross-package wiring the release depends on
 * — web build runs first and writes into packages/cli/dist/web — is exercised
 * and verifiable from phase 1 instead of at release time.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../cli/dist/web');

mkdirSync(outDir, { recursive: true });
writeFileSync(
  resolve(outDir, 'index.html'),
  `<!doctype html>
<meta charset="utf-8">
<title>RepoReaper</title>
<p>The RepoReaper web UI is not built yet. Run the TUI with <code>npx reporeaper</code>.</p>
`,
);

process.stdout.write(`web: wrote placeholder build to ${outDir}\n`);
