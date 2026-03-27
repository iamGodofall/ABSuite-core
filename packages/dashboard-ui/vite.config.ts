// @ts-ignore
import { defineConfig } from 'vite';
// @ts-ignore
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
server: { port: 3001, open: true }
});
