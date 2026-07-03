import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Buffer/process globals required by bip39, bip32, bitcoinjs-lib in the browser.
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: `${root}popup.html`,
        recover: `${root}recover.html`,
        serviceWorker: `${root}src/background/serviceWorker.ts`,
      },
      output: {
        // The service worker must sit at a stable path referenced by manifest.json.
        entryFileNames: (chunk) =>
          chunk.name === 'serviceWorker' ? 'serviceWorker.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});
