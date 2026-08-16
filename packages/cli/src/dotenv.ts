import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Minimal `.env` reader for `reporeaper ui`.
 *
 * Hand-rolled rather than pulled from a dependency: this needs to read one
 * variable out of a two-line file, and the published package should not carry a
 * runtime dependency for that. It deliberately does no interpolation, no
 * command substitution, and no export syntax — a `.env` here holds a token, and
 * a parser that can evaluate things is a parser that can be surprised.
 *
 * Existing environment variables always win, so `GITHUB_TOKEN=… reporeaper ui`
 * behaves the way the shell leads you to expect.
 */
export function loadDotEnv(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = resolve(cwd, '.env');
  if (!existsSync(path)) return;

  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    return; // unreadable .env is not worth failing a command over
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);

    env[key] = value;
  }
}
