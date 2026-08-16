#!/usr/bin/env node
/**
 * reporeaper executable.
 *
 * Bare invocation opens the TUI, but only with a real terminal: Ink needs raw
 * mode, and in CI or a pipe it would crash instead of explaining itself. The
 * non-interactive path is what scripts should use.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubProvider } from '@reporeaper/core';
import { Command } from 'commander';
import { runBatchCommand } from './commands/batch-command.js';
import { runUiCommand } from './commands/ui.js';
import { NoTokenError, resolveToken, TOKEN_HELP } from './token.js';

function version(): string {
  const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version: string }).version;
}

/** Starts the Ink TUI. Imported lazily so scripted runs never load React. */
async function startTui(): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write(
      'reporeaper needs an interactive terminal for its TUI.\n\n' +
        'For scripts and CI, use the non-interactive commands:\n' +
        '  reporeaper delete <pattern> --yes\n' +
        '  reporeaper archive <pattern> --yes\n\n' +
        `${TOKEN_HELP}\n`,
    );
    return 2;
  }

  const token = await resolveToken();
  const [{ render }, React, { App }] = await Promise.all([
    import('ink'),
    import('react'),
    import('./tui/app.js'),
  ]);

  let failed = false;
  const instance = render(
    React.createElement(App, {
      provider: new GitHubProvider(token),
      onFatalError: () => {
        failed = true;
      },
    }),
  );
  await instance.waitUntilExit();
  // A session that ended on the error screen did not succeed, and a script
  // wrapping this should be able to tell.
  return failed ? 1 : 0;
}

/** Runs the CLI and returns an exit code. */
export async function main(argv: string[] = process.argv): Promise<number> {
  const program = new Command();
  let exitCode = 0;

  program
    .name('reporeaper')
    .description('Batch archive or delete your personal GitHub repositories.')
    .version(version())
    .helpOption('-h, --help', 'Show help');

  program
    .command('delete')
    .argument('<pattern>', 'substring matched against repository names and descriptions')
    .description('Delete every personal repository matching the pattern')
    .option('-y, --yes', 'skip the confirmation (required for non-interactive use)')
    .option('--dry-run', 'list what would be deleted and stop')
    .action(async (pattern: string, options: { yes?: boolean; dryRun?: boolean }) => {
      exitCode = await runBatchCommand('delete', pattern, options);
    });

  program
    .command('archive')
    .argument('<pattern>', 'substring matched against repository names and descriptions')
    .description('Archive every personal repository matching the pattern')
    .option('-y, --yes', 'skip the confirmation (required for non-interactive use)')
    .option('--dry-run', 'list what would be archived and stop')
    .action(async (pattern: string, options: { yes?: boolean; dryRun?: boolean }) => {
      exitCode = await runBatchCommand('archive', pattern, options);
    });

  program
    .command('ui')
    .description('Serve the web UI on 127.0.0.1 and open it')
    .option('-p, --port <port>', 'port to listen on', (value) => Number.parseInt(value, 10))
    .option('--no-open', 'do not open a browser')
    .option('--dev-session', "hand the session secret to this project's Vite dev server")
    .action(async (options: { port?: number; open?: boolean; devSession?: boolean }) => {
      exitCode = await runUiCommand(options);
    });

  // Bare invocation means the TUI; commander would otherwise print help.
  const rest = argv.slice(2);
  const hasCommand = rest.some((argument) => !argument.startsWith('-'));
  const wantsInfo = ['--help', '-h', '--version', '-V'].some((flag) => rest.includes(flag));

  if (!hasCommand && !wantsInfo) {
    // Flags without a command are almost always a mistyped subcommand
    // (`reporeaper -p 9000` meaning `reporeaper ui -p 9000`). Starting the TUI
    // and quietly discarding them is the wrong kind of forgiving.
    if (rest.length > 0) {
      process.stderr.write(
        `Unknown options for the interactive UI: ${rest.join(' ')}\n` +
          'Did you mean `reporeaper ui`? Run `reporeaper --help` for the commands.\n',
      );
      return 2;
    }
    return startTui();
  }

  await program.parseAsync(argv);
  return exitCode;
}

/** Turns an expected failure into a message, not a stack trace. */
function reportFailure(error: unknown): void {
  if (error instanceof NoTokenError) {
    process.stderr.write(`${error.message}\n`);
    return;
  }
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected error'}\n`);
}

/**
 * True only when this file was executed, not imported. The token-hygiene probe
 * imports this module, and a looser check would make that import launch the CLI.
 *
 * Both sides are resolved through realpath because an installed package is
 * invoked through a `node_modules/.bin` symlink: comparing the raw paths makes
 * every global install a no-op, which is a silent failure rather than a loud
 * one.
 */
function isExecutedDirectly(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return realpathSync(resolve(invoked)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isDirectRun = isExecutedDirectly();
if (isDirectRun) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      reportFailure(error);
      process.exitCode = 1;
    });
}
