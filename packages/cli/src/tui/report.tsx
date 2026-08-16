import { sanitizeDisplay, type ActionResult } from '@reporeaper/core';
import { Box, Text } from 'ink';
import React from 'react';

/**
 * Per-repository outcome report.
 *
 * Every repository gets a line, including the ones that were skipped and why.
 * A batch that reports only a total leaves the user unable to tell which
 * repositories still exist.
 */

export interface ReportProps {
  results: ActionResult[];
  running: boolean;
  total: number;
}

function symbolFor(result: ActionResult): { glyph: string; color: string } {
  switch (result.outcome) {
    case 'ok':
      return { glyph: '✓', color: 'green' };
    case 'already-gone':
      return { glyph: '✓', color: 'green' };
    case 'changed-since-listing':
      return { glyph: '!', color: 'yellow' };
    default:
      return { glyph: '✗', color: 'red' };
  }
}

function detailFor(result: ActionResult): string {
  switch (result.outcome) {
    case 'ok':
      return result.action === 'delete' ? 'deleted' : 'archived';
    case 'already-gone':
      return 'already gone';
    default:
      return sanitizeDisplay(result.error ?? 'failed', 80);
  }
}

export function Report({ results, running, total }: ReportProps): React.JSX.Element {
  const failed = results.filter((result) => !result.ok);

  return (
    <Box flexDirection="column">
      <Text bold>
        {running ? `Working… ${results.length}/${total}` : `Done — ${results.length}/${total}`}
      </Text>

      {results.map((result) => {
        const { glyph, color } = symbolFor(result);
        return (
          <Text key={`${result.repo.id}-${result.action}`}>
            <Text color={color}>{glyph}</Text> {sanitizeDisplay(result.repo.name, 40)}{' '}
            <Text dimColor>{detailFor(result)}</Text>
          </Text>
        );
      })}

      {!running ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {results.length - failed.length} succeeded, {failed.length} failed.
          </Text>
          {failed.length > 0 ? (
            <Text dimColor>
              Press r to retry the {failed.length} that did not succeed, q to quit.
            </Text>
          ) : (
            <Text dimColor>Press q to quit.</Text>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
