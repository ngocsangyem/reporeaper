import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where `reporeaper ui --dev-session` hands its session secret to the Vite dev
 * server.
 *
 * This exists only for developing the web UI with hot reload. In that setup
 * Vite serves the document, so it cannot receive the secret the way a real run
 * does (injected into the page by our own server), and every request would be
 * refused.
 *
 * Both sides derive the path from the port so they cannot disagree — a mismatch
 * would silently break the dev workflow again. It is opt-in, written with
 * owner-only permissions, and removed when the server stops; a normal
 * `reporeaper ui` never writes it.
 */
export function devSessionPath(port: number): string {
  return join(tmpdir(), `reporeaper-dev-session-${port}`);
}
