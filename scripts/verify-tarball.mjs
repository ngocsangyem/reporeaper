/**
 * Packs the published package and installs the tarball into a scratch project.
 *
 * Workspace-local runs cannot catch the failure this guards against: inside the
 * monorepo, `@reporeaper/*` resolves through symlinks, so a published tarball
 * that still declares those private packages as dependencies looks fine locally
 * and 404s for every user. The only honest check is installing the tarball
 * outside the workspace and running its bin.
 *
 * Run after `pnpm build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = join(repoRoot, 'packages/cli');
const scratch = mkdtempSync(join(tmpdir(), 'reporeaper-tarball-'));
const failures = [];

const COMMAND_TIMEOUT_MS = 300_000;

/** Runs a command and returns its stdout, throwing on a non-zero exit. */
function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

try {
  run('npm', ['pack', '--pack-destination', scratch, '--ignore-scripts'], cliDir);
  const tarball = readdirSync(scratch).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) throw new Error('npm pack produced no tarball');
  const tarballPath = join(scratch, tarball);

  // 1. Contents: web assets present, no secrets, no stray workspace files.
  const listing = run('tar', ['-tzf', tarballPath], scratch)
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ''));

  if (!listing.some((entry) => entry.startsWith('dist/web/'))) {
    failures.push('tarball is missing the built web assets under dist/web/');
  }
  const secrets = listing.filter((entry) => entry === '.env' || entry.startsWith('.env.'));
  if (secrets.length > 0) {
    failures.push(`tarball contains env files: ${secrets.join(', ')}`);
  }

  // 2. Dependencies: no private workspace packages may survive into the manifest.
  // Read this from the tarball itself rather than from the install, so a bad
  // manifest reports as a clear assertion instead of an npm resolution crash.
  const packedManifest = JSON.parse(
    run('tar', ['-xzOf', tarballPath, 'package/package.json'], scratch),
  );
  // npm 7+ installs peerDependencies automatically, and optionalDependencies
  // are attempted too, so all three maps can 404 an installer — not just
  // `dependencies`.
  const packedPrivateDeps = ['dependencies', 'peerDependencies', 'optionalDependencies'].flatMap(
    (field) =>
      Object.keys(packedManifest[field] ?? {})
        .filter((name) => name.startsWith('@reporeaper/'))
        .map((name) => `${name} (${field})`),
  );
  if (packedPrivateDeps.length > 0) {
    failures.push(
      `published dependencies reference private workspace packages: ${packedPrivateDeps.join(', ')}`,
    );
  }

  // 3. The tarball installs outside the workspace and its bin runs. Skipped when
  // the manifest is already known bad, so the reported failure stays the cause
  // rather than the npm resolution error it produces.
  if (packedPrivateDeps.length === 0) {
    const project = join(scratch, 'consumer');
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, version: '0.0.0' }),
    );

    let installed = true;
    try {
      execFileSync('npm', ['install', '--no-audit', '--no-fund', tarballPath], {
        cwd: project,
        stdio: 'pipe',
        timeout: COMMAND_TIMEOUT_MS,
      });
    } catch (error) {
      installed = false;
      const detail = error.stderr?.toString().trim().split('\n').slice(-3).join(' ') ?? '';
      failures.push(`tarball failed to install into a clean project: ${detail}`);
    }

    if (installed) {
      // A timeout matters here: from phase 4 the bin is an interactive TUI, and
      // without one a bin awaiting stdin would hang CI until the job ceiling.
      try {
        const binOutput = execFileSync('npx', ['--no-install', 'reporeaper', '--version'], {
          cwd: project,
          encoding: 'utf8',
          timeout: 60_000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (!/^reporeaper \d+\.\d+\.\d+/m.test(binOutput)) {
          failures.push(`installed bin did not report its version (got: ${binOutput.trim()})`);
        }
      } catch (error) {
        const reason = error.code === 'ETIMEDOUT' ? 'timed out' : `exited ${error.status}`;
        failures.push(`installed bin ${reason}`);
      }
    }
  }

  console.log(`verify-tarball: packed ${tarball}`);
} catch (error) {
  // Keep the curated failure list as the output of record; a raw stack here
  // would bury the reason the gate tripped.
  failures.push(`verification could not complete: ${error.message}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('verify-tarball FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('verify-tarball: tarball is self-contained');
