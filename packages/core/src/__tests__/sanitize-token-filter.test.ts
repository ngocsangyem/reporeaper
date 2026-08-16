import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { filterRepos } from '../filter.js';
import { sanitizeDisplay } from '../sanitize.js';
import { GitHubToken } from '../token.js';
import type { Repo } from '../types.js';

const ESC = String.fromCharCode(0x1b);
const CR = String.fromCharCode(0x0d);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

describe('sanitizeDisplay', () => {
  it('strips ANSI cursor movement used to redraw a confirmation prompt', () => {
    const hostile = `harmless${ESC}[2A${CR}rm -rf everything`;

    const safe = sanitizeDisplay(hostile);

    expect(safe).not.toContain(ESC);
    expect(safe).not.toContain(CR);
    expect(safe).toBe('harmlessrm -rf everything');
  });

  it('strips bidi overrides that make a name render in reverse', () => {
    const safe = sanitizeDisplay(`evil${RIGHT_TO_LEFT_OVERRIDE}txt.repo`);

    expect(safe).not.toContain(RIGHT_TO_LEFT_OVERRIDE);
  });

  it('strips an OSC sequence including its payload', () => {
    const safe = sanitizeDisplay(`${ESC}]0;window title${String.fromCharCode(7)}repo`);

    expect(safe).toBe('repo');
  });

  it('truncates without letting a long name flood the display', () => {
    const safe = sanitizeDisplay('a'.repeat(500), 50);

    expect(safe).toHaveLength(50);
  });

  it('leaves ordinary text, including non-Latin scripts, intact', () => {
    expect(sanitizeDisplay('my-repo (fork of upstream)')).toBe('my-repo (fork of upstream)');
    expect(sanitizeDisplay('kho-lưu-trữ')).toBe('kho-lưu-trữ');
  });
});

describe('GitHubToken', () => {
  const secret = 'ghp_supersecretvalue0000000000000000';
  const token = new GitHubToken(secret);

  it('never reveals the value through any string form', () => {
    // These three have different reach; util.inspect is the one that sees
    // private state, and the one console.log actually uses.
    expect(String(token)).toBe('[redacted]');
    expect(JSON.stringify(token)).toBe('"[redacted]"');
    expect(inspect(token, { depth: 8, showHidden: true })).not.toContain(secret);
    expect(inspect({ nested: { token } }, { depth: 8, showHidden: true })).not.toContain(secret);
  });

  it('still produces a usable authorization header', () => {
    expect(token.authorizationHeader).toBe(`Bearer ${secret}`);
  });

  it('recognizes fine-grained and classic tokens', () => {
    expect(new GitHubToken('github_pat_11ABC').kind).toBe('fine-grained');
    expect(new GitHubToken('ghp_abc').kind).toBe('classic');
    expect(new GitHubToken('mystery').kind).toBe('unknown');
  });

  it('rejects an empty token instead of making an unauthenticated request', () => {
    expect(() => new GitHubToken('   ')).toThrow(/empty/);
  });
});

describe('filterRepos', () => {
  const repos = [
    { name: 'website', description: 'marketing pages' },
    { name: 'api-server', description: null },
    { name: 'Notes', description: 'Personal JOURNAL entries' },
  ].map((partial, index) => ({ id: index, ...partial }) as unknown as Repo);

  it('matches a case-insensitive substring of the name', () => {
    expect(filterRepos(repos, 'API').map((repo) => repo.name)).toEqual(['api-server']);
    expect(filterRepos(repos, 'notes').map((repo) => repo.name)).toEqual(['Notes']);
  });

  it('matches the description too', () => {
    expect(filterRepos(repos, 'journal').map((repo) => repo.name)).toEqual(['Notes']);
  });

  it('returns everything for an empty query', () => {
    expect(filterRepos(repos, '   ')).toHaveLength(3);
  });

  it('does not fuzzy match — a near miss selects nothing', () => {
    // Fuzzy matching would surface "website" for "wbste". On a delete screen,
    // offering repositories the user did not ask for is the dangerous direction.
    expect(filterRepos(repos, 'wbste')).toHaveLength(0);
  });
});
