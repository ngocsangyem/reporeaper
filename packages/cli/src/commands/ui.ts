import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createProxyApp } from '@reporeaper/core';
import { devSessionPath } from '@reporeaper/core/dev-session';
import { loadDotEnv } from '../dotenv.js';
import { rawTokenFromEnvironment } from '../token.js';

/**
 * `reporeaper ui` — the local web UI.
 *
 * Bound to 127.0.0.1 only. Any page in the user's browser can send a simple
 * cross-site request to localhost while this is running, and DNS rebinding
 * defeats an origin check on its own, so the proxy additionally requires a
 * per-process session token, which is injected into the served document
 * rather than the URL so it never reaches a command line or browser history.
 */

const DEFAULT_PORT = 7433;

/** Static file types the SPA needs; anything else is not served. */
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

/**
 * Locates the built SPA.
 *
 * One canonical location, resolved relative to this module, so it works the
 * same from a global install as from the workspace.
 */
export function webRoot(): string {
  return fileURLToPath(new URL('./web', import.meta.url));
}

/** Reports which process holds a port, so the user can decide what to do. */
function describePortHolder(port: number): string {
  try {
    const output = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = output.split('\n')[1];
    return line ? ` It is held by: ${line.trim().split(/\s+/).slice(0, 2).join(' pid ')}.` : '';
  } catch {
    return '';
  }
}

/** Opens the default browser, ignoring failure — the URL is printed anyway. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* the printed URL is the fallback */
  }
}

/**
 * Serves one static file from the web root.
 *
 * The requested path is resolved and then checked to still be inside the root,
 * so `../` cannot walk out of it and serve arbitrary files from the user's
 * machine over the loopback port.
 *
 * The session secret is injected into the HTML rather than carried in the URL.
 * A URL is passed to the browser as a command-line argument, which on a shared
 * machine is readable by any other local user through the process table — and
 * it then persists in browser history. Serving it in the document keeps it to
 * the one place it is needed: another origin cannot read this response, because
 * no CORS header permits it.
 */
function serveStatic(root: string, pathname: string, sessionToken: string): Response {
  const relative =
    pathname === '/' ? 'index.html' : normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(join(root, relative));

  if (!candidate.startsWith(resolve(root))) {
    return new Response('Not found', { status: 404 });
  }

  const file =
    existsSync(candidate) && extname(candidate) !== '' ? candidate : join(root, 'index.html');
  if (!existsSync(file)) {
    return new Response('The web UI is not built.', { status: 404 });
  }

  if (extname(file) === '.html') {
    const html = readFileSync(file, 'utf8').replace(
      '</head>',
      `<meta name="reporeaper-session" content="${sessionToken}"></head>`,
    );
    return new Response(html, {
      headers: {
        'content-type': CONTENT_TYPES['.html'] as string,
        // The document carries a secret, so it must not be stored anywhere.
        'cache-control': 'no-store',
      },
    });
  }

  return new Response(readFileSync(file), {
    headers: { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' },
  });
}

export interface UiOptions {
  port?: number;
  open?: boolean;
  /**
   * Hand the session secret to a local Vite dev server. Only for developing
   * this project's web UI — see `devSessionPath`.
   */
  devSession?: boolean;
}

/**
 * Publishes the session secret for the Vite dev server, and takes it away
 * again when this process ends — including on Ctrl-C, which is how this
 * command normally exits.
 */
function publishDevSession(port: number, sessionToken: string): void {
  const path = devSessionPath(port);
  writeFileSync(path, sessionToken, { mode: 0o600 });

  const remove = (): void => {
    try {
      rmSync(path, { force: true });
    } catch {
      /* the file is in a temp directory; failing to clean it must not crash */
    }
  };

  process.on('exit', remove);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      remove();
      process.exit(0);
    });
  }

  process.stdout.write(
    `Dev session published for the Vite dev server (${path}).\n` +
      'It is removed when this process stops.\n\n',
  );
}

/** Starts the local server. Resolves once it is listening. */
export async function runUiCommand(options: UiOptions = {}): Promise<number> {
  const port = options.port ?? DEFAULT_PORT;
  const root = webRoot();

  if (!existsSync(join(root, 'index.html'))) {
    process.stderr.write('The web UI assets are missing from this installation.\n');
    return 1;
  }

  // The README tells people to put their token in .env for this command, so
  // this command has to actually read it.
  loadDotEnv();

  const token = rawTokenFromEnvironment();
  const sessionToken = randomBytes(24).toString('base64url');

  if (options.devSession === true) publishDevSession(port, sessionToken);

  const api = createProxyApp({
    isLoopback: true,
    // The value that was actually resolved, not a second read of the
    // environment with different precedence — which could report "using your
    // token" while the proxy resolved a different one, or none.
    envToken: token,
    sessionToken,
    port,
  });

  const app = {
    fetch: (request: Request): Response | Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return api.fetch(request);
      return serveStatic(root, url.pathname, sessionToken);
    },
  };

  return new Promise<number>((resolvePromise) => {
    const server = serve(
      // Binding to 127.0.0.1 rather than 0.0.0.0 keeps this off the local
      // network entirely: a laptop on café wifi should not expose a delete
      // endpoint to the subnet.
      { fetch: app.fetch, port, hostname: '127.0.0.1' },
      () => {
        // No secret in the URL: it would end up in the browser's argv, its
        // history, and its session restore.
        const url = `http://127.0.0.1:${port}/`;
        process.stdout.write(
          `RepoReaper is running at:\n\n  ${url}\n\n` +
            `${token ? 'Using the token from your environment.' : 'No token in the environment — paste one in the UI.'}\n` +
            'Press Ctrl-C to stop.\n',
        );
        if (options.open !== false) openBrowser(url);
      },
    );

    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        // Silently picking another port is how orphaned servers accumulate; the
        // user should know what is already there.
        process.stderr.write(
          `Port ${port} is already in use.${describePortHolder(port)}\n` +
            `Stop it, or choose another port with --port.\n`,
        );
        resolvePromise(1);
        return;
      }
      process.stderr.write(`Could not start the server: ${error.message}\n`);
      resolvePromise(1);
    });
  });
}
