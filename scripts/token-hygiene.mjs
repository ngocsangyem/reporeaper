/**
 * Token-hygiene gate (runtime sentinel).
 *
 * Drives every package that can hold a GitHub token with sentinel values in the
 * environment and asserts they never surface in stdout, stderr, a thrown error,
 * an HTTP response, an exported value, or a file written to disk.
 *
 * This exists because a `console.` grep is not a real control: it misses
 * process.stdout.write, third-party loggers, and error serialization. The
 * scoped ESLint rule and this harness are both merge gates.
 *
 * Known coverage limits, stated so the gate is not read as broader than it is:
 * a token handed to a spawned grandchild process, or sent over the network, is
 * not observed here. Neither is a token written to a stream other than stdout
 * or stderr. The harness also only imports each entry and drives an exported
 * request handler — it does not run the CLI as a process, so output produced
 * during a real `reporeaper delete` run is outside what this proves.
 *
 * Run after `pnpm build` (it probes built output, plus the serverless entry
 * bundled on the fly).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = join(repoRoot, 'scripts', 'token-hygiene-probe.mjs');
const PROBE_TIMEOUT_MS = 60_000;

/**
 * One sentinel per variable, so a finding names the variable that escaped.
 * These are fake values that never authenticate anything.
 */
const SENTINELS = {
  GITHUB_TOKEN: 'ghp_S3NT1NELgithubToken00000000000000',
  GH_TOKEN: 'ghp_S3NT1NELghToken0000000000000000000',
  REPOREAPER_ACCESS_PASSWORD: 'S3NT1NELaccessPassword000000000000000',
};

/** Packages whose built entry points can hold a token. */
const probedPackages = ['packages/core', 'packages/cli'];

/**
 * Collects the entry points a package publishes (exports + bin), so adding a
 * new entry in a later phase cannot silently narrow this gate.
 */
function declaredEntries(packageDir) {
  const manifest = JSON.parse(readFileSync(join(repoRoot, packageDir, 'package.json'), 'utf8'));
  const entries = new Set();

  const exports = manifest.exports ?? {};
  for (const value of Object.values(exports)) {
    const target = typeof value === 'string' ? value : value?.import;
    if (typeof target === 'string' && target.endsWith('.js')) entries.add(target);
  }
  for (const target of Object.values(manifest.bin ?? {})) {
    if (typeof target === 'string') entries.add(target);
  }

  return [...entries].map((entry) => ({
    name: `${manifest.name}:${entry.replace(/^\.\//, '')}`,
    path: join(repoRoot, packageDir, entry),
  }));
}

/**
 * The serverless entry ships as TypeScript (Vercel compiles it), so bundle it
 * to give it the same runtime coverage as the built packages.
 */
async function bundleApiEntries(outDir) {
  const apiDir = join(repoRoot, 'api');
  const sources = readdirSync(apiDir).filter((entry) => entry.endsWith('.ts'));
  const bundled = [];

  for (const [index, source] of sources.entries()) {
    const outfile = join(outDir, `api-entry-${index}.mjs`);
    await build({
      entryPoints: [join(apiDir, source)],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      logLevel: 'silent',
    });
    bundled.push({ name: `api:${source}`, path: outfile });
  }
  return bundled;
}

/** Runs one probe and returns the failures it produced. */
function probeTarget(target, sandbox, reportPath) {
  rmSync(reportPath, { force: true });

  const result = spawnSync(
    process.execPath,
    [probe, target.path, reportPath, JSON.stringify(SENTINELS)],
    {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      // A sandboxed HOME and cwd give the disk scan somewhere to catch a token
      // that gets cached to a config file.
      cwd: sandbox,
      env: { ...process.env, ...SENTINELS, HOME: sandbox, TMPDIR: sandbox },
    },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const failures = [];

  if (result.error?.code === 'ETIMEDOUT') {
    failures.push(`${target.name}: probe timed out after ${PROBE_TIMEOUT_MS}ms`);
  }
  for (const [envVar, value] of Object.entries(SENTINELS)) {
    if (output.includes(value)) {
      failures.push(`${target.name}: ${envVar} written to stdout/stderr`);
    }
  }

  if (!existsSync(reportPath)) {
    failures.push(`${target.name}: probe produced no report (exit ${result.status})`);
    return failures;
  }

  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  for (const finding of report.findings) {
    failures.push(`${target.name}: ${finding.envVar} exposed via ${finding.where}`);
  }
  if (!report.completed) {
    failures.push(`${target.name}: probe did not complete (exit ${result.status})`);
  }
  return failures;
}

/** Walks the sandbox and reports any file that captured a sentinel. */
function scanDisk(sandbox, skip) {
  const failures = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (skip.has(full)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      let contents;
      try {
        contents = readFileSync(full, 'utf8');
      } catch {
        continue; // unreadable or binary-only files cannot be checked this way
      }
      for (const [envVar, value] of Object.entries(SENTINELS)) {
        if (contents.includes(value)) {
          failures.push(`${envVar} written to disk at ${relative(sandbox, full)}`);
        }
      }
    }
  }

  walk(sandbox);
  return failures;
}

const targets = probedPackages.flatMap(declaredEntries);
const missing = targets.filter((target) => !existsSync(target.path));
if (missing.length > 0) {
  console.error(
    `token-hygiene: missing build output for ${missing
      .map((target) => target.name)
      .join(', ')}. Run "pnpm build" first.`,
  );
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'reporeaper-hygiene-'));
const sandbox = join(scratch, 'sandbox');
const bundleDir = join(scratch, 'bundles');
mkdirSync(sandbox);
mkdirSync(bundleDir);

let failures = [];
try {
  const allTargets = [...targets, ...(await bundleApiEntries(bundleDir))];
  const reportPath = join(scratch, 'report.json');

  for (const target of allTargets) {
    failures = failures.concat(probeTarget(target, sandbox, reportPath));
  }
  failures = failures.concat(scanDisk(sandbox, new Set()));

  console.log(`token-hygiene: probed ${allTargets.map((target) => target.name).join(', ')}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('token-hygiene FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('token-hygiene: no sentinel leakage detected');
