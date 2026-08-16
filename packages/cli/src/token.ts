import { createInterface } from 'node:readline';
import { GitHubToken } from '@reporeaper/core';

/**
 * Token resolution for the CLI.
 *
 * Order is `GITHUB_TOKEN`, then `GH_TOKEN` (what the official gh CLI exports),
 * then a masked prompt. Nothing is ever written to disk: a cached token file
 * would outlive the session and turn a laptop into a standing delete
 * credential.
 */

export class NoTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoTokenError';
  }
}

export const TOKEN_HELP =
  'Set GITHUB_TOKEN (or GH_TOKEN) to a personal access token with permission to ' +
  'administer your repositories. See the README for which permissions to grant.';

/** Reads a token from the environment, if one is there. */
export function tokenFromEnvironment(env: NodeJS.ProcessEnv = process.env): GitHubToken | null {
  const raw = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  return raw ? new GitHubToken(raw) : null;
}

/**
 * Prompts for a token without echoing it.
 *
 * Requires a TTY: prompting on a pipe would either hang forever or read the
 * next line of piped data as if it were a secret.
 */
export async function promptForToken(): Promise<GitHubToken> {
  if (!process.stdin.isTTY) {
    throw new NoTokenError(`No token found and no terminal to prompt on. ${TOKEN_HELP}`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  // readline echoes by default; muting the output stream keeps the token off
  // the screen and out of any scrollback the user later pastes somewhere.
  const output = rl as unknown as { output?: NodeJS.WriteStream; _writeToOutput?: unknown };
  output._writeToOutput = function writeMasked(this: unknown, text: string) {
    if (text.includes('GitHub token')) {
      process.stdout.write(text);
    }
  };

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question('GitHub token (input hidden): ', resolve);
    });
    process.stdout.write('\n');

    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      throw new NoTokenError(`No token entered. ${TOKEN_HELP}`);
    }
    return new GitHubToken(trimmed);
  } finally {
    rl.close();
  }
}

/** Environment first, then a prompt when a terminal is available. */
export async function resolveToken(): Promise<GitHubToken> {
  return tokenFromEnvironment() ?? (await promptForToken());
}
