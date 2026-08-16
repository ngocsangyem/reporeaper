import { sanitizeDisplay, type Repo, type RepoAction } from '@reporeaper/core';
import { Box, Text } from 'ink';
import React from 'react';

/**
 * The confirmation gate: type the number of selected repositories.
 *
 * Typing a count rather than pressing y/n forces the user to read the number,
 * and it scales — asking someone to retype forty repository names guarantees
 * they stop reading. The id is shown beside every name because names are the
 * spoofable part.
 */

export interface ConfirmProps {
  repos: Repo[];
  action: RepoAction;
  typed: string;
  error?: string | undefined;
}

/** Repos whose deletion GitHub support cannot undo. */
export function notRestorable(repos: Repo[]): Repo[] {
  return repos.filter((repo) => repo.fork || repo.forksCount > 0);
}

export function Confirm({ repos, action, typed, error }: ConfirmProps): React.JSX.Element {
  const irreversible = notRestorable(repos);
  const missingAdmin = repos.filter((repo) => !repo.permissions.admin);

  return (
    <Box flexDirection="column">
      <Text bold color={action === 'delete' ? 'red' : 'yellow'}>
        {action === 'delete' ? 'DELETE' : 'ARCHIVE'} {repos.length} repositor
        {repos.length === 1 ? 'y' : 'ies'}
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {repos.slice(0, 20).map((repo) => (
          <Text key={repo.id}>
            {'  '}
            {sanitizeDisplay(repo.name, 40)} <Text dimColor>#{repo.id}</Text>
          </Text>
        ))}
        {repos.length > 20 ? (
          <Text dimColor>
            {'  '}… and {repos.length - 20} more
          </Text>
        ) : null}
      </Box>

      {action === 'delete' ? (
        <Box flexDirection="column" marginTop={1}>
          {irreversible.length > 0 ? (
            // GitHub can restore a deleted repository within 90 days only if it
            // is not part of a fork network. Saying "restorable" flatly would be
            // a false reassurance for exactly these repositories.
            <Text color="red">
              {irreversible.length} of these are in a fork network and CANNOT be restored.
            </Text>
          ) : (
            <Text dimColor>
              Deleted repositories can usually be restored within 90 days — but not forks.
            </Text>
          )}
        </Box>
      ) : (
        <Text dimColor>Archiving is reversible: an archived repository can be unarchived.</Text>
      )}

      {missingAdmin.length > 0 ? (
        <Text color="yellow">
          {missingAdmin.length} lack admin rights and will fail; deselect them to avoid errors.
        </Text>
      ) : null}

      <Box marginTop={1}>
        <Text>
          Type {repos.length} to confirm (Esc to cancel): <Text color="cyan">{typed}</Text>
        </Text>
      </Box>
      {error ? <Text color="red">{error}</Text> : null}
    </Box>
  );
}
