/**
 * Self-test for the token-hygiene gate.
 *
 * A gate that cannot fail is theater. This drives the probe against modules
 * that leak in known-hard ways and asserts each one is caught. Every case here
 * is a shape that previously slipped through:
 *
 *   - a token wrapper whose toString/toJSON return "[redacted]" (the exact
 *     design this project relies on) — only util.inspect sees it
 *   - a token inside a Map, which JSON.stringify renders as {}
 *   - an Error `cause`, which is non-enumerable
 *   - a module that writes to stdout without a trailing newline, which used to
 *     splice itself onto the probe's report line and hide it
 *
 * Run: node scripts/token-hygiene-selftest.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const probe = join(repoRoot, 'scripts', 'token-hygiene-probe.mjs');
const SENTINELS = { GITHUB_TOKEN: 'ghp_S3NT1NELselftest0000000000000000' };

/** Each case must produce at least one finding. */
const cases = {
  'redacting wrapper that mirrors the token on a public property': `
    class Token {
      #value;
      constructor(value) { this.#value = value; this.value = value; }
      toString() { return '[redacted]'; }
      toJSON() { return '[redacted]'; }
    }
    export const token = new Token(process.env.GITHUB_TOKEN);
  `,
  'token inside a Map': `
    export const cache = new Map([['auth', process.env.GITHUB_TOKEN]]);
  `,
  'token in a non-enumerable error cause': `
    export const failure = new Error('request failed', { cause: process.env.GITHUB_TOKEN });
  `,
  'stdout write with no trailing newline': `
    process.stdout.write('booting ' + process.env.GITHUB_TOKEN);
    export const conf = { auth: process.env.GITHUB_TOKEN };
  `,
  'token in a response body': `
    export default function handler() {
      return new Response(JSON.stringify({ token: process.env.GITHUB_TOKEN }));
    }
  `,
};

/**
 * Cases that must NOT be flagged. These pin the token wrapper design phase 2
 * has to implement: the value lives in a true private field with no public
 * mirror, which puts it out of reach of String, JSON.stringify, and inspect
 * alike. They also keep the gate from degenerating into "flag everything".
 */
const safeCases = {
  'token wrapper with a private field and no public mirror': `
    class Token {
      #value;
      constructor(value) { this.#value = value; }
      get header() { return 'Bearer ' + this.#value; }
      toString() { return '[redacted]'; }
      toJSON() { return '[redacted]'; }
    }
    export const token = new Token(process.env.GITHUB_TOKEN);
  `,
  'module that holds no token at all': `
    export const name = '@reporeaper/example';
  `,
};

const scratch = mkdtempSync(join(tmpdir(), 'reporeaper-selftest-'));
const failures = [];

/** Runs the probe against one generated module and returns whether it flagged. */
function runProbe(name, source) {
  const modulePath = join(scratch, `${name.replace(/\W+/g, '-')}.mjs`);
  const reportPath = join(scratch, 'report.json');
  writeFileSync(modulePath, source);

  const result = spawnSync(
    process.execPath,
    [probe, modulePath, reportPath, JSON.stringify(SENTINELS)],
    { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...SENTINELS } },
  );

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  return report.findings.length > 0 || output.includes(SENTINELS.GITHUB_TOKEN);
}

try {
  for (const [name, source] of Object.entries(cases)) {
    if (!runProbe(name, source)) failures.push(`undetected leak: ${name}`);
  }
  for (const [name, source] of Object.entries(safeCases)) {
    if (runProbe(name, source)) failures.push(`false positive: ${name}`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('token-hygiene selftest FAILED:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `token-hygiene selftest: ${Object.keys(cases).length} leak shapes detected, ` +
    `${Object.keys(safeCases).length} safe shapes not flagged`,
);
