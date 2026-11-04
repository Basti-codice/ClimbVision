import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// COOP/COEP: macht die Seite "cross-origin isolated" (SharedArrayBuffer, WASM-Threads, präzise Timer).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  plugins: [svelte()],
  server: { host: '127.0.0.1', port: 5173, headers: isolation },
  preview: { host: '127.0.0.1', port: 4173, headers: isolation },
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env['EXP'] ? ['node_modules/**'] : ['node_modules/**', 'tests/_exp/**'],
    environment: 'node',
    testTimeout: 120000,
  },
} as import('vite').UserConfig);
