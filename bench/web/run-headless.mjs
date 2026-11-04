// Usage: node run-headless.mjs [--out results.json] [--iters 100] [--headed] [--gpu]
//   --headed : real window (needed to use the real iGPU for WebGL/WebGPU)
//   --gpu    : additionally run MediaPipe with delegate:'GPU' and ONNX with WebGPU
// Needs: npm i; bash ../fetch-models.sh ; (optional) ONNX model in models/
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // global Playwright; or `npm i -D playwright`
import fs from 'node:fs'; import path from 'node:path'; import url from 'node:url';
import { serve } from './serve.mjs';
const here = path.dirname(url.fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const iters = +arg('iters', 100), warmup = 15, out = arg('out', path.join(here, 'results.json'));
const { srv, port } = await serve(here);
const headed = process.argv.includes('--headed'), gpu = process.argv.includes('--gpu');
const browser = await chromium.launch({ headless: !headed, args: ['--enable-unsafe-webgpu'] });
const page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror', e.message));
await page.goto(`http://127.0.0.1:${port}/index.html`);
await page.waitForFunction('window.benchReady === true', null, { timeout: 30000 });
const results = { env: await page.evaluate('window.envInfo()'), when: new Date().toISOString(), runs: [] };
console.log(results.env);
const run = async (fn, cfg) => { try { const r = await page.evaluate(([f, c]) => window[f](c), [fn, cfg]); console.log(JSON.stringify(r)); results.runs.push(r); }
  catch (e) { const r = { fn, cfg, error: String(e.message).slice(0, 300) }; console.log(JSON.stringify(r)); results.runs.push(r); } };
// bus.jpg: a full-body person is found (zidane.jpg is upper-body only -> pose detector finds nothing; see docs/BENCHMARKS.md)
const variants = [{ img: '/fixtures/bus.jpg', w: 810, h: 1080, fit: 'stretch' }, { img: '/fixtures/bus.jpg', w: 1280, h: 720, fit: 'letterbox' }];
for (const v of variants) for (const m of ['lite', 'full', 'heavy']) for (const mode of ['image', 'video'])
  await run('benchMediaPipe', { kind: 'pose', model: `/models/pose_${m}.task`, ...v, mode, warmup, iters });
// Hand: no image with a visible hand available offline -> this only measures the palm-detector "no hand" path.
await run('benchMediaPipe', { kind: 'hand', model: '/models/hand.task', img: '/fixtures/bus.jpg', w: 1280, h: 720, fit: 'letterbox', mode: 'video', warmup, iters });
// ONNX models (dropped into models/ by bench/py/export_yolo.py etc.)
const onnx = JSON.parse(fs.existsSync(path.join(here, 'models/onnx.json')) ? fs.readFileSync(path.join(here, 'models/onnx.json'), 'utf8') : '[]');
for (const m of onnx) {
  for (const threads of [1, 2, 4])
    await run('benchOrt', { model: `/models/${m.file}`, ep: 'wasm', threads, size: m.size, warmup: 8, iters: Math.min(iters, 40) });
  if (gpu) await run('benchOrt', { model: `/models/${m.file}`, ep: 'webgpu', threads: 1, size: m.size, warmup: 8, iters: Math.min(iters, 40) });
}
if (gpu) for (const m of ['lite', 'full']) for (const mode of ['video'])
  await run('benchMediaPipe', { kind: 'pose', model: `/models/pose_${m}.task`, ...variants[1], mode, warmup, iters, delegate: 'GPU' });
fs.writeFileSync(out, JSON.stringify(results, null, 2));
await browser.close(); srv.close();
