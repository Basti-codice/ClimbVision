// Kopiert das MediaPipe-IIFE-Bundle + WASM nach public/vendor (klassische Worker, versionsgepinnt, kein Bundling).
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, 'node_modules/@mediapipe/tasks-vision');
const dst = path.join(root, 'public/vendor/mediapipe');
if (!fs.existsSync(src)) { console.log('copy-vendor: @mediapipe/tasks-vision nicht installiert – übersprungen'); process.exit(0); }
fs.mkdirSync(path.join(dst, 'wasm'), { recursive: true });
fs.copyFileSync(path.join(src, 'vision_bundle.js'), path.join(dst, 'vision_bundle.js'));
for (const f of fs.readdirSync(path.join(src, 'wasm'))) fs.copyFileSync(path.join(src, 'wasm', f), path.join(dst, 'wasm', f));
console.log('copy-vendor: MediaPipe nach public/vendor/mediapipe kopiert');
