// Plattformunabhängiger Download der Benchmark-Eingaben (Windows/macOS/Linux): node fetch-models.mjs
import fs from 'node:fs'; import path from 'node:path';
const out = process.env.BENCH_OUT ?? path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'web');
const B = 'https://storage.googleapis.com/mediapipe-models';
const files = [
  ...['lite', 'full', 'heavy'].map((v) => [`models/pose_${v}.task`, `${B}/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`]),
  ['models/hand.task', `${B}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`],
  ['fixtures/bus.jpg', 'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg'],
  ['fixtures/zidane.jpg', 'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/zidane.jpg'],
];
for (const [rel, url] of files) {
  const dst = path.join(out, rel); if (fs.existsSync(dst)) { console.log('vorhanden:', rel); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer())); console.log('geladen:', rel);
}
console.log('ok');
