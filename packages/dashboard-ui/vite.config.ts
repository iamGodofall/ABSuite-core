import { readFileSync } from 'node:fs';
// @ts-ignore
import { defineConfig } from 'vite';
// @ts-ignore
import react from '@vitejs/plugin-react';
// @ts-ignore
import tsconfigPaths from 'vite-tsconfig-paths';

// Read once at config time so the UI reports the version in its own manifest
// rather than a string somebody has to remember to update.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
  },
  plugins: [react(), tsconfigPaths()],
  server: { 
    host: true,
    cors: true,
    port: 3001, 
    open: true,
    hmr: {
      host: 'localhost',
      port: 3001,
      clientPort: 3001,
      protocol: 'ws'
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          state: ['zustand']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'recharts', 'zustand', 'lucide-react']
  }
});
