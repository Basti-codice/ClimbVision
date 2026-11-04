import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// COOP/COEP: macht die Seite "cross-origin isolated" (SharedArrayBuffer, WASM-Threads, präzise Timer).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** Sicherheits-Header für alle Antworten; Worker-/Vendor-Skripte erhalten eine strengere CSP ohne jede externe Verbindung (Telemetrie-Schutz). */
function securityHeaders(): import('vite').Plugin {
  const app = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: mediastream:; connect-src 'self' ws: wss: https://storage.googleapis.com; object-src 'none'; base-uri 'none'";
  const worker = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'";
  const mw = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, next: () => void): void => {
    const u = req.url ?? '';
    res.setHeader('Content-Security-Policy', u.startsWith('/workers/') || u.startsWith('/vendor/') ? worker : app);
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  };
  return { name: 'climbvision-security-headers', configureServer: (s) => { s.middlewares.use(mw); }, configurePreviewServer: (s) => { s.middlewares.use(mw); } };
}

/** Kopiert MediaPipe (IIFE-Bundle + WASM) nach public/vendor – klassische Worker können es nicht über Vite bündeln. Läuft bei jedem dev/build-Start (plattformunabhängig, kein postinstall nötig). */
function mediapipeVendor(): import('vite').Plugin {
  return {
    name: 'climbvision-mediapipe-vendor',
    buildStart() {
      const src = path.resolve('node_modules/@mediapipe/tasks-vision'), dst = path.resolve('public/vendor/mediapipe');
      if (!fs.existsSync(src)) throw new Error('@mediapipe/tasks-vision fehlt. Bitte „npm install“ ausführen.');
      fs.mkdirSync(path.join(dst, 'wasm'), { recursive: true });
      fs.copyFileSync(path.join(src, 'vision_bundle.js'), path.join(dst, 'vision_bundle.js'));
      for (const f of fs.readdirSync(path.join(src, 'wasm'))) fs.copyFileSync(path.join(src, 'wasm', f), path.join(dst, 'wasm', f));
    },
  };
}

export default defineConfig({
  plugins: [mediapipeVendor(), svelte(), securityHeaders()],
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
