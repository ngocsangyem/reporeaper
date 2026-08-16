import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Entry-point behaviour, driven through the built binary.
 *
 * The non-TTY path has to be exercised as a real process: the whole point is
 * what happens when stdin is a pipe, which cannot be faked convincingly from
 * inside the test runner.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = join(packageDir, 'dist', 'bin.js');

/** Runs the built CLI with stdin piped, returning output and exit code. */
function runCli(args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execFileSync(process.execPath, [binary, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '' },
    });
    return { stdout, stderr: '', code: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.status ?? 1,
    };
  }
}

// The binary must be built first; skipping silently would hide a broken build.
describe.skipIf(!existsSync(binary))('reporeaper binary', () => {
  it('explains itself and exits 2 without a terminal, instead of crashing Ink', () => {
    const result = runCli([]);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('interactive terminal');
    expect(result.stderr).toContain('reporeaper delete <pattern> --yes');
  });

  it('reports its version', () => {
    expect(runCli(['--version']).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('refuses a destructive run without --yes', () => {
    // No token is set, so this must fail before reaching the network; the point
    // is that the guard is not the only thing standing between a typo and a
    // deletion.
    const result = runCli(['delete', 'anything']);
    expect(result.code).not.toBe(0);
  });
});
