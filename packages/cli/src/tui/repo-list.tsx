import { sanitizeDisplay, type Repo } from '@reporeaper/core';
import { Box, Text } from 'ink';
import React from 'react';

/**
 * Windowed repository list.
 *
 * Ink re-renders the whole tree, so drawing a thousand rows makes the terminal
 * crawl. Only the visible slice is rendered; the cursor and the selection live
 * in the parent, keyed by repository id rather than list position — a filter
 * change reorders rows, and index-based selection would silently retarget to
 * whatever moved into that slot.
 */

export const WINDOW_SIZE = 12;

export interface RepoListProps {
  repos: Repo[];
  selectedIds: ReadonlySet<number>;
  cursor: number;
  query: string;
}

/** Returns the slice of rows to draw, keeping the cursor inside the window. */
export function windowFor(
  total: number,
  cursor: number,
  size: number = WINDOW_SIZE,
): { start: number; end: number } {
  if (total <= size) return { start: 0, end: total };

  const half = Math.floor(size / 2);
  const start = Math.min(Math.max(0, cursor - half), total - size);
  return { start, end: start + size };
}

export function RepoList({ repos, selectedIds, cursor, query }: RepoListProps): React.JSX.Element {
  const { start, end } = windowFor(repos.length, cursor);
  const visible = repos.slice(start, end);

  return (
    <Box flexDirection="column">
      <Box>
        <Text>Search: </Text>
        <Text color="cyan">{query.length > 0 ? sanitizeDisplay(query, 60) : '(all)'}</Text>
        <Text dimColor>
          {'  '}
          {repos.length} shown, {selectedIds.size} selected
        </Text>
      </Box>

      {repos.length === 0 ? (
        <Text dimColor>No repositories match.</Text>
      ) : (
        visible.map((repo, offset) => {
          const index = start + offset;
          const isCursor = index === cursor;
          const isSelected = selectedIds.has(repo.id);

          return (
            <Box key={repo.id}>
              <Text color={isCursor ? 'cyan' : undefined}>
                {isCursor ? '>' : ' '} [{isSelected ? 'x' : ' '}] {sanitizeDisplay(repo.name, 40)}
              </Text>
              <Text dimColor>
                {'  '}#{repo.id}
                {repo.archived ? ' archived' : ''}
                {repo.private ? ' private' : ''}
                {repo.fork || repo.forksCount > 0 ? ' fork-network' : ''}
                {repo.permissions.admin ? '' : ' no-admin'}
              </Text>
            </Box>
          );
        })
      )}

      {end < repos.length ? <Text dimColor>… {repos.length - end} more below</Text> : null}
    </Box>
  );
}
