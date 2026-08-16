import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createProxyApp } from '@reporeaper/core';
import { tokenFromEnvironment } from '../token.js';

/**
 * `reporeaper ui` — the local web UI.
 *
 * Bound to 127.0.0.1 only. Any page in the user's browser can send a simple
 * cross-site request to localhost while this is running, and DNS rebinding
 * defeats an origin check on its own, so the proxy additionally requires a
 * per-process session token that only appears in the launch URL.
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
 */
function serveStatic(root: string, pathname: string): Response {
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

  return new Response(readFileSync(file), {
    headers: { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' },
  });
}

export interface UiOptions {
  port?: number;
  open?: boolean;
}

/** Starts the local server. Resolves once it is listening. */
export async function runUiCommand(options: UiOptions = {}): Promise<number> {
  const port = options.port ?? DEFAULT_PORT;
  const root = webRoot();

  if (!existsSync(join(root, 'index.html'))) {
    process.stderr.write('The web UI assets are missing from this installation.\n');
    return 1;
  }

  const token = tokenFromEnvironment();
  const sessionToken = randomBytes(24).toString('base64url');

  const api = createProxyApp({
    isLoopback: true,
    envToken: token ? process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null : null,
    sessionToken,
    port,
  });

  const app = {
    fetch: (request: Request): Response | Promise<Response> => {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return api.fetch(request);
      return serveStatic(root, url.pathname);
    },
  };

  return new Promise<number>((resolvePromise) => {
    const server = serve(
      // Binding to 127.0.0.1 rather than 0.0.0.0 keeps this off the local
      // network entirely: a laptop on café wifi should not expose a delete
      // endpoint to the subnet.
      { fetch: app.fetch, port, hostname: '127.0.0.1' },
      () => {
        const url = `http://127.0.0.1:${port}/?s=${sessionToken}`;
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
