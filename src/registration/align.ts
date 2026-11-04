/**
 * Bildbasierte Registrierung (Lucas–Kanade mit Homographie-Modell, Bildpyramide).
 * Aufgabe: Rest-Verschiebung zwischen dem gespeicherten entzerrten Referenzbild (Template) und dem neu entzerrten Bild bestimmen.
 * Ergebnis hRes bildet Template-Koordinaten auf Bild-Koordinaten ab (normalisierte Wandkoordinaten 0..1).
 */
import { applyH, inv3, mul3, solveLinear, type Mat3, type Vec2 } from '../geometry/homography';
import { downscale, normalizeGray, sampleBilinear, type Gray } from '../image/raster';
import { pointInPolygon, centroid, bbox } from '../geometry/polygon';

export interface AlignOptions {
  /** Arbeitsbreite der feinsten Pyramidenstufe (Pixel). */
  workWidth: number;
  levels: number;
  maxIter: number;
  /** Levenberg-Dämpfung. */
  lambda: number;
}
export const DEFAULT_ALIGN: AlignOptions = { workWidth: 384, levels: 3, maxIter: 40, lambda: 1e-3 };

export interface AlignResult {
  /** Template(normalisiert 0..1) → Bild(normalisiert 0..1). */
  hRes: Mat3;
  ncc: number;
  nccVorher: number;
  iterationen: number;
  konvergiert: boolean;
  /** NCC je Quadrant [TL, TR, BL, BR] nach der Ausrichtung. */
  quadrantNcc: [number, number, number, number];
}

const pm = (p: readonly number[]): Mat3 => [1 + (p[0] as number), p[2] as number, p[4] as number, p[1] as number, 1 + (p[3] as number), p[5] as number, p[6] as number, p[7] as number, 1];

/** ZNCC über gültige Pixel; optional nur ein Rechteck der Template-Pixel. */
function zncc(T: Gray, I: Gray, W: Mat3, region?: [number, number, number, number]): number {
  const w = T.width, h = T.height;
  const [x0, y0, x1, y1] = region ?? [0, 0, w, h];
  let n = 0, st = 0, si = 0, stt = 0, sii = 0, sti = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const [u, v] = applyH(W, [x / w, y / h]);
      const iv = sampleBilinear(I, u * I.width, v * I.height);
      if (Number.isNaN(iv)) continue;
      const tv = T.data[y * w + x] as number;
      n++; st += tv; si += iv; stt += tv * tv; sii += iv * iv; sti += tv * iv;
    }
  if (n < 50) return 0;
  const cov = sti / n - (st / n) * (si / n);
  const vt = stt / n - (st / n) ** 2, vi = sii / n - (si / n) ** 2;
  return vt > 1e-9 && vi > 1e-9 ? cov / Math.sqrt(vt * vi) : 0;
}

function lkLevel(T: Gray, I: Gray, p: number[], opt: AlignOptions): { iterations: number; converged: boolean } {
  const w = T.width, h = T.height;
  const step = 2;
  let lambda = opt.lambda;
  let prevErr = Infinity;
  let it = 0;
  for (; it < opt.maxIter; it++) {
    const H = pm(p);
    const JtJ: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
    const Jtr = new Array<number>(8).fill(0);
    let err = 0, cnt = 0;
    for (let y = 1; y < h - 1; y += step)
      for (let x = 1; x < w - 1; x += step) {
        // Koordinaten zentriert in [-1,1] für Konditionierung
        const xn = (x / w) * 2 - 1, yn = (y / h) * 2 - 1;
        const D = H[6] * xn + H[7] * yn + 1;
        const wx = (H[0] * xn + H[1] * yn + H[2]) / D, wy = (H[3] * xn + H[4] * yn + H[5]) / D;
        const ix = ((wx + 1) / 2) * I.width, iy = ((wy + 1) / 2) * I.height;
        const val = sampleBilinear(I, ix, iy);
        if (Number.isNaN(val)) continue;
        const gx = (sampleBilinear(I, ix + 1, iy) - sampleBilinear(I, ix - 1, iy)) * 0.5 * (I.width / 2);
        const gy = (sampleBilinear(I, ix, iy + 1) - sampleBilinear(I, ix, iy - 1)) * 0.5 * (I.height / 2);
        if (Number.isNaN(gx) || Number.isNaN(gy)) continue;
        const r = (T.data[y * w + x] as number) - val;
        const J = [
          (gx * xn) / D, (gy * xn) / D, (gx * yn) / D, (gy * yn) / D, gx / D, gy / D,
          (-(gx * wx + gy * wy) * xn) / D, (-(gx * wx + gy * wy) * yn) / D,
        ];
        for (let a = 0; a < 8; a++) {
          Jtr[a] = (Jtr[a] as number) + (J[a] as number) * r;
          for (let b = 0; b < 8; b++) (JtJ[a] as number[])[b] = ((JtJ[a] as number[])[b] as number) + (J[a] as number) * (J[b] as number);
        }
        err += r * r; cnt++;
      }
    if (cnt < 100) return { iterations: it, converged: false };
    err /= cnt;
    if (err > prevErr * 1.0001) { lambda *= 10; if (lambda > 1e6) return { iterations: it, converged: false }; } else lambda = Math.max(1e-6, lambda / 3);
    prevErr = Math.min(prevErr, err);
    for (let a = 0; a < 8; a++) (JtJ[a] as number[])[a] = ((JtJ[a] as number[])[a] as number) * (1 + lambda) + 1e-9;
    let dp: number[];
    try { dp = solveLinear(JtJ, Jtr); } catch { return { iterations: it, converged: false }; }
    let mag = 0;
    for (let a = 0; a < 8; a++) { p[a] = (p[a] as number) + (dp[a] as number); mag = Math.max(mag, Math.abs(dp[a] as number)); }
    if (mag < 1e-5) return { iterations: it + 1, converged: true };
  }
  return { iterations: it, converged: false };
}

/** Konvertiert Parameter im zentrierten [-1,1]-Raum in eine Matrix im [0,1]-Raum. */
function centeredToUnit(Hc: Mat3): Mat3 {
  const S: Mat3 = [2, 0, -1, 0, 2, -1, 0, 0, 1]; // unit → centered
  const Si = inv3(S);
  return mul3(mul3(Si, Hc), S);
}

export function alignHomography(template: Gray, image: Gray, partial: Partial<AlignOptions> = {}): AlignResult {
  const o = { ...DEFAULT_ALIGN, ...partial };
  const f = Math.max(1, template.width / o.workWidth);
  const T0 = normalizeGray(downscale(template, f));
  const I0 = normalizeGray(downscale(image, f * (image.width / template.width)));
  // Pyramide
  const Ts: Gray[] = [T0], Is: Gray[] = [I0];
  for (let l = 1; l < o.levels; l++) { Ts.unshift(normalizeGray(downscale(Ts[0] as Gray, 2))); Is.unshift(normalizeGray(downscale(Is[0] as Gray, 2))); }
  const p = new Array<number>(8).fill(0);
  let iterations = 0, converged = true;
  for (let l = 0; l < o.levels; l++) {
    const r = lkLevel(Ts[l] as Gray, Is[l] as Gray, p, o);
    iterations += r.iterations;
    converged = r.converged;
  }
  const hRes = centeredToUnit(pm(p));
  const T = Ts[o.levels - 1] as Gray, I = Is[o.levels - 1] as Gray;
  const idm: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const w = T.width, h = T.height;
  const q = (x0: number, y0: number, x1: number, y1: number): number => zncc(T, I, hRes, [x0, y0, x1, y1]);
  const hw = w >> 1, hh = h >> 1;
  return {
    hRes, ncc: zncc(T, I, hRes), nccVorher: zncc(T, I, idm), iterationen: iterations, konvergiert: converged,
    quadrantNcc: [q(0, 0, hw, hh), q(hw, 0, w, hh), q(0, hh, hw, h), q(hw, hh, w, h)],
  };
}

/** Maximale Verschiebung der vier Wandecken unter hRes (normalisierte Einheiten, auf Wandbreite bezogen). */
export function cornerShift(hRes: Mat3, aspekt: number): number {
  let m = 0;
  for (const c of [[0, 0], [1, 0], [1, 1], [0, 1]] as Vec2[]) {
    const q = applyH(hRes, c);
    m = Math.max(m, Math.hypot((q[0] - c[0]) , (q[1] - c[1]) / Math.max(1e-6, aspekt)));
  }
  return m;
}

/** Griff-Kontrast: Mittelwert |innen − Ring| über alle Griffe (0..1 bei Graustufen/255). Prüft, ob Griffkonturen auf Bildkanten liegen. */
export function holdContrast(g: Gray, polys: readonly (readonly Vec2[])[], maxHolds = 150): number {
  const step = Math.max(1, Math.floor(polys.length / maxHolds));
  let sum = 0, n = 0;
  for (let k = 0; k < polys.length; k += step) {
    const poly = polys[k] as readonly Vec2[];
    const c = centroid(poly), b = bbox(poly);
    let inS = 0, inN = 0, ringS = 0, ringN = 0;
    const nx = 6, ny = 6;
    for (let iy = 0; iy < ny; iy++)
      for (let ix = 0; ix < nx; ix++) {
        const p: Vec2 = [b[0] + ((ix + 0.5) / nx) * (b[2] - b[0]), b[1] + ((iy + 0.5) / ny) * (b[3] - b[1])];
        if (!pointInPolygon(p, poly)) continue;
        const v = sampleBilinear(g, p[0] * g.width, p[1] * g.height);
        if (!Number.isNaN(v)) { inS += v; inN++; }
      }
    for (const v of poly) {
      for (const s of [1.3, 1.6]) {
        const q: Vec2 = [c[0] + (v[0] - c[0]) * s, c[1] + (v[1] - c[1]) * s];
        const iv = sampleBilinear(g, q[0] * g.width, q[1] * g.height);
        if (!Number.isNaN(iv) && !pointInPolygon(q, poly)) { ringS += iv; ringN++; }
      }
    }
    if (inN > 2 && ringN > 2) { sum += Math.abs(inS / inN - ringS / ringN) / 255; n++; }
  }
  return n ? sum / n : 0;
}
