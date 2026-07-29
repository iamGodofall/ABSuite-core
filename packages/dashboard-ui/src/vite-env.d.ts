/// <reference types="vite/client" />

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

/** Injected by Vite from packages/dashboard-ui/package.json at build time. */
declare const __APP_VERSION__: string;
