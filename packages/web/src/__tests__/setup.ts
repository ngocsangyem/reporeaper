import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Unmount between tests.
 *
 * Without this, a test that opened the confirm dialog leaves Radix's
 * `pointer-events: none` on <body> and its DOM in place, so the next test
 * cannot click anything and finds duplicate elements. The failure looks like a
 * product bug and is not one.
 */
afterEach(() => {
  cleanup();
  document.body.style.pointerEvents = '';
});
