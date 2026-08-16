/**
 * Display sanitization for provider-supplied strings.
 *
 * Repository names and descriptions are attacker-influenced text that this app
 * prints next to a destructive confirmation. Without stripping, a name can carry
 * ANSI cursor movement to redraw the terminal, or a bidi override to make
 * `evil-repo` render as something reassuring. Either turns the confirm step into
 * a lie, so every provider string passes through here before display.
 *
 * This is written against code points rather than regex character classes: the
 * characters being matched are invisible in source, and a mistyped range in a
 * literal fails open without looking wrong.
 */

const ESCAPE = 0x1b;
const BELL = 0x07;
const DEFAULT_MAX_LENGTH = 200;

/** C0 (includes CR, LF, TAB, ESC) and C1 control ranges. */
function isControl(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/** Bidi overrides, isolates, and marks — they reorder rendered text. */
function isBidiControl(codePoint: number): boolean {
  return (
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069) ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    codePoint === 0x061c
  );
}

/** True for the final byte of an ANSI CSI sequence (the `@`..`~` range). */
function isCsiTerminator(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e;
}

/**
 * Skips one ANSI escape sequence starting at `start` (which must be ESC).
 * Returns the index just past the sequence.
 */
function skipEscapeSequence(units: number[], start: number): number {
  const next = units[start + 1];
  let index = start + 2;

  // CSI: ESC [ ... final-byte
  if (next === 0x5b) {
    while (index < units.length && !isCsiTerminator(units[index] as number)) index += 1;
    return index + 1;
  }

  // OSC: ESC ] ... (BEL | ESC \)
  if (next === 0x5d) {
    while (index < units.length) {
      const unit = units[index] as number;
      if (unit === BELL) return index + 1;
      if (unit === ESCAPE && units[index + 1] === 0x5c) return index + 2;
      index += 1;
    }
    return index;
  }

  // Any other two-character escape.
  return start + 2;
}

/**
 * Returns a string that is safe to print in a terminal or a browser.
 *
 * NFKC normalization runs first so compatibility forms collapse before the
 * control-character pass rather than after it.
 */
export function sanitizeDisplay(value: string, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const normalized = value.normalize('NFKC');
  const units = [...normalized].map((character) => character.codePointAt(0) as number);
  const kept: string[] = [];

  let index = 0;
  while (index < units.length) {
    const codePoint = units[index] as number;

    if (codePoint === ESCAPE) {
      index = skipEscapeSequence(units, index);
      continue;
    }
    if (!isControl(codePoint) && !isBidiControl(codePoint)) {
      kept.push(String.fromCodePoint(codePoint));
    }
    index += 1;
  }

  const collapsed = kept.join('').replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength - 1)}…` : collapsed;
}
