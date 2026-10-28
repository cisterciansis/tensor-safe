import tailwindcss from '@tailwindcss/postcss';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig(({ isSsrBuild }) => ({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./', import.meta.url)),
      },
      // Polkadot platform shims: use the web-global variants in the browser.
      {
        find: /^@polkadot\/wasm-crypto-init$/,
        replacement: '@polkadot/wasm-crypto-init/none',
      },
      ...['textdecoder', 'textencoder', 'randomvalues', 'fetch', 'ws'].map(
        (name) => ({
          find: new RegExp(`^@polkadot/x-${name}$`),
          replacement: `@polkadot/x-${name}/browser`,
        }),
      ),
    ],
  },
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  server: {
    port: 3000,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  // `vite build` emits the SPA; `vite build --ssr server/main.ts` emits the
  // Node server with node_modules left external (Vite's SSR default).
  build: isSsrBuild
    ? { target: 'node22', copyPublicDir: false }
    : { outDir: 'dist/client' },
}));
