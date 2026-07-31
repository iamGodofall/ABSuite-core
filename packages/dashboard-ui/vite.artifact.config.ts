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

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-artifact',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
