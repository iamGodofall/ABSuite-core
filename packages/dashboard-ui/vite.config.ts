// @ts-ignore
import { defineConfig } from 'vite';
// @ts-ignore
import react from '@vitejs/plugin-react';
// @ts-ignore
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
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
