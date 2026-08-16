/**
 * Token-hygiene gate (runtime sentinel).
 *
 * Drives every package that can hold a GitHub token with a sentinel value in
 * the environment and asserts the sentinel never surfaces in stdout, stderr, a
 * thrown error, an HTTP response, or an exported value.
 *
 * This exists because a `console.` grep is not a real control: it misses
 * process.stdout.write, third-party loggers, and error serialization. The
 * scoped ESLint rule and this harness are both merge gates.
 *
 * Run after `pnpm build` (it probes built output, plus the serverless entry
 * bundled on the fly).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = join(repoRoot, 'scripts', 'token-hygiene-probe.mjs');
const SENTINEL = 'ghp_S3NT1NELdoNotLog000000000000000000';

/** Built entry points that can hold a token. */
const builtTargets = [
  { name: 'core', path: join(repoRoot, 'packages/core/dist/index.js') },
  { name: 'cli', path: join(repoRoot, 'packages/cli/dist/index.js') },
  { name: 'cli/bin', path: join(repoRoot, 'packages/cli/dist/bin.js') },
];

/**
 * The serverless entry ships as TypeScript (Vercel compiles it), so bundle it
 * to a temp file to give it the same runtime coverage as the built packages.
 */
async function bundleApiEntry(outDir) {
  const outfile = join(outDir, 'api-entry.mjs');
  await build({
    entryPoints: [join(repoRoot, 'api/[...path].ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'silent',
  });
  return { name: 'api', path: outfile };
}

/** Runs one probe and returns the failures it produced. */
function probeTarget(target) {
  const result = spawnSync(process.execPath, [probe, target.path, SENTINEL], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_TOKEN: SENTINEL,
      GH_TOKEN: SENTINEL,
      REPOREAPER_ACCESS_PASSWORD: SENTINEL,
    },
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failures = [];

  if (result.status !== 0) {
    failures.push(`${target.name}: probe exited ${result.status}`);
  }
  if (output.includes(SENTINEL)) {
    failures.push(`${target.name}: sentinel token written to stdout/stderr`);
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('LEAK ')) {
      failures.push(`${target.name}: sentinel token exposed via ${line.slice(5)}`);
    }
  }
  if (!output.includes('PROBE_OK') && result.status === 0) {
    failures.push(`${target.name}: probe did not complete`);
  }
  return failures;
}

const missing = builtTargets.filter((target) => !existsSync(target.path));
if (missing.length > 0) {
  console.error(
    `token-hygiene: missing build output for ${missing
      .map((target) => target.name)
      .join(', ')}. Run "pnpm build" first.`,
  );
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'reporeaper-hygiene-'));
let failures = [];
try {
  const targets = [...builtTargets, await bundleApiEntry(scratch)];
  for (const target of targets) {
    failures = failures.concat(probeTarget(target));
  }
  console.log(`token-hygiene: probed ${targets.map((t) => t.name).join(', ')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('token-hygiene FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('token-hygiene: no sentinel leakage detected');
