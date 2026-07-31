/**
 * A single-file build, for looking at the room without running the stack.
 *
 * Everything is inlined into one HTML document so it can be opened from a URL
 * with no server behind it. The API calls still go out and still fail, which is
 * the honest outcome: every reading shows UNKNOWN — "this screen has not been
 * able to ask" — rather than a plausible number. That is exactly what the
 * interface is supposed to do when it cannot reach its evidence, and it means
 * the shared copy is a fair look at the room rather than a staged one.
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const { version } = createRequire(import.meta.url)('./package.json');

export default defineConfig({
  /*
   * The same compile-time constants the real build defines.
   *
   * This config omitted them, so __APP_VERSION__ stayed a bare identifier and
   * the bundle threw a ReferenceError at first render — a blank page, from a
   * build that reported success. It only surfaced when the footer started
   * reading the version at the top level instead of inside a panel nobody had
   * opened. Anything vite.config.ts defines has to be defined here too.
   */
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  build: {
    outDir: 'dist-artifact',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
