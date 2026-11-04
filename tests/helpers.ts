/** Test-Helfer: JPEG laden/schreiben, kleine Zeichenroutinen. Nur für Tests/Experimente. */
import fs from 'node:fs';
import jpeg from 'jpeg-js';
import type { Rgba } from '../src/image/raster';

export function loadJpeg(path: string): Rgba {
  const d = jpeg.decode(fs.readFileSync(path), { useTArray: true, formatAsRGBA: true });
  return { width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) };
}
export function saveJpeg(img: Rgba, path: string, quality = 90): void {
  fs.writeFileSync(path, jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data) }, quality).data);
}
export function drawPolyline(img: Rgba, pts: readonly (readonly [number, number])[], rgb: [number, number, number], close = true): void {
  const n = pts.length;
  for (let i = 0; i < (close ? n : n - 1); i++) {
    const a = pts[i] as readonly [number, number], b = pts[(i + 1) % n] as readonly [number, number];
    const steps = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))) + 1;
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(a[0] + ((b[0] - a[0]) * s) / steps), y = Math.round(a[1] + ((b[1] - a[1]) * s) / steps);
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const o = (y * img.width + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2];
    }
  }
}

/** Synthetisches Wandbild: dunkle Wand, helle Ellipsen (teils berührend), Rauschen. */
export function syntheticWall(w: number, h: number, opt: { texture?: boolean; seed?: number } = {}): { img: Rgba; truth: { cx: number; cy: number; rx: number; ry: number }[] } {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = opt.seed ?? 11; const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const truth: { cx: number; cy: number; rx: number; ry: number }[] = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) truth.push({ cx: 60 + c * 90 + rnd() * 10, cy: 60 + r * 80 + rnd() * 10, rx: 18 + rnd() * 8, ry: 14 + rnd() * 8 });
  // zwei berührende Griffe
  truth.push({ cx: 600, cy: 160, rx: 22, ry: 18 }, { cx: 640, cy: 160, rx: 22, ry: 18 });
  // optionale weiche Hintergrundtextur (Kreideflecken/Maserung) für Registrierungs-/Drift-Tests
  const blobs: { x: number; y: number; r: number; a: number }[] = [];
  if (opt.texture) for (let i = 0; i < 90; i++) blobs.push({ x: rnd() * w, y: rnd() * h, r: 6 + rnd() * 14, a: (rnd() - 0.3) * 40 });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 30 + rnd() * 6;
    for (const bl of blobs) { const d2 = ((x - bl.x) ** 2 + (y - bl.y) ** 2) / (bl.r * bl.r); if (d2 < 9) v += bl.a * Math.exp(-d2); }
    for (const t of truth) if (((x - t.cx) / t.rx) ** 2 + ((y - t.cy) / t.ry) ** 2 <= 1) { v = 190 + rnd() * 10; break; }
    const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { img: { width: w, height: h, data }, truth };
}


import type { Kp, PoseCandidate } from '../src/pose/landmarks';
/** Synthetische Pose (normalisierte Bildkoordinaten): Hüfte bei (hx,hy), Körperhöhe s; Hand-/Fußpunkte frei setzbar. */
export function makePose(hx: number, hy: number, s = 0.2, over: Partial<Record<number, Partial<Kp>>> = {}): PoseCandidate {
  const k: Kp[] = Array.from({ length: 33 }, () => ({ x: hx, y: hy, c: 0.95 }));
  const set = (i: number, dx: number, dy: number): void => { k[i] = { x: hx + dx * s, y: hy + dy * s, c: 0.95 }; };
  set(0, 0, -1.3); set(11, -0.25, -1); set(12, 0.25, -1); set(13, -0.35, -0.6); set(14, 0.35, -0.6); set(15, -0.4, -0.2); set(16, 0.4, -0.2);
  set(17, -0.42, -0.1); set(18, 0.42, -0.1); set(19, -0.4, -0.12); set(20, 0.4, -0.12); set(21, -0.36, -0.14); set(22, 0.36, -0.14);
  set(23, -0.15, 0); set(24, 0.15, 0); set(25, -0.18, 0.5); set(26, 0.18, 0.5); set(27, -0.2, 1); set(28, 0.2, 1);
  set(29, -0.2, 1.08); set(30, 0.2, 1.08); set(31, -0.2, 1.15); set(32, 0.2, 1.15);
  for (const [i, o] of Object.entries(over)) k[Number(i)] = { ...(k[Number(i)] as Kp), ...o };
  return { keypoints: k, score: 0.95 };
}
