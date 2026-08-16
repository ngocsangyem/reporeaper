import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  dts: true,
  // The web build writes into dist/web and runs first (turbo orders
  // reporeaper#build after @reporeaper/web#build), so the clean pass must spare
  // it. Patterns are relative to outDir and support negation.
  clean: ['!web/**'],
  sourcemap: true,
  // The published tarball must not reference the private @reporeaper/* workspace
  // packages, so core is inlined into the bundle (verified by the pack-and-install
  // step in CI).
  noExternal: [/^@reporeaper\//],
});
