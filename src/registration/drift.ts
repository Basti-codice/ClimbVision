/** Live-Drift-Überwachung: Anker-Patches im Wandraum per NCC-Template-Matching nachverfolgen. */
import { downscale, newGray, type Gray } from '../image/raster';
import { pointInPolygon } from '../geometry/polygon';
import type { Vec2 } from '../geometry/homography';

export interface Anchor { u: number; v: number; patch: Float32Array; size: number }
export interface DriftMeasure {
  /** Median-Verschiebung in Wandbreiten (normalisiert, x/y getrennt). */
  dx: number; dy: number;
  betrag: number;
  sichtbar: number; // Anteil der verwendbaren Anker
  gueltig: number;  // Anteil mit NCC ≥ 0.6
  status: 'ok' | 'warnung' | 'verloren';
}

export const DRIFT_WARN = 0.005, DRIFT_LOST = 0.015;

function patchAt(g: Gray, cx: number, cy: number, s: number): Float32Array | null {
  const x0 = Math.round(cx - s / 2), y0 = Math.round(cy - s / 2);
  if (x0 < 0 || y0 < 0 || x0 + s > g.width || y0 + s > g.height) return null;
  const out = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) out[y * s + x] = g.data[(y0 + y) * g.width + x0 + x] as number;
  return out;
}
const variance = (a: Float32Array): number => { let m = 0; for (const v of a) m += v; m /= a.length; let q = 0; for (const v of a) q += (v - m) ** 2; return q / a.length; };

/** Wählt bis zu cells×cells texturreiche Anker außerhalb von Griffen (gleichmäßig verteilt). */
export function selectAnchors(ref: Gray, holds: readonly (readonly Vec2[])[], opt: { cells?: number; size?: number; workWidth?: number } = {}): Anchor[] {
  const cells = opt.cells ?? 4, size = opt.size ?? 24;
  const f = Math.max(1, ref.width / (opt.workWidth ?? 512));
  const g = downscale(ref, f);
  const out: Anchor[] = [];
  for (let cy = 0; cy < cells; cy++)
    for (let cx = 0; cx < cells; cx++) {
      let best: Anchor | null = null, bestVar = 20; // Mindesttextur
      const x0 = (cx / cells) * g.width, x1 = ((cx + 1) / cells) * g.width, y0 = (cy / cells) * g.height, y1 = ((cy + 1) / cells) * g.height;
      for (let y = y0 + size; y < y1 - size; y += 6)
        for (let x = x0 + size; x < x1 - size; x += 6) {
          const nearHold = holds.some((h) => {
            // Patch-Ecken und Mitte dürfen in keinem Griff liegen
            const pts: Vec2[] = [[x, y], [x - size / 2, y - size / 2], [x + size / 2, y - size / 2], [x - size / 2, y + size / 2], [x + size / 2, y + size / 2]];
            return pts.some((p) => pointInPolygon([p[0] / g.width, p[1] / g.height], h));
          });
          if (nearHold) continue;
          const p = patchAt(g, x, y, size);
          if (!p) continue;
          const v = variance(p);
          if (v > bestVar) { bestVar = v; best = { u: x / g.width, v: y / g.height, patch: p, size }; }
        }
      if (best) out.push(best);
    }
  return out;
}

function nccPatch(g: Gray, cx: number, cy: number, a: Anchor): number {
  const s = a.size, x0 = Math.round(cx - s / 2), y0 = Math.round(cy - s / 2);
  if (x0 < 0 || y0 < 0 || x0 + s > g.width || y0 + s > g.height) return -1;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const n = s * s;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const p = a.patch[y * s + x] as number, q = g.data[(y0 + y) * g.width + x0 + x] as number;
    sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q;
  }
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  return va > 1e-6 && vb > 1e-6 ? (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb) : -1;
}

export interface DriftOptions { workWidth?: number; searchPx?: number; maskBoxes?: readonly (readonly [number, number, number, number])[] }

/** Misst die aktuelle Verschiebung der Anker im neu entzerrten Wandbild `cur` (Referenz-Anker aus selectAnchors, gleiche workWidth). */
export function measureDrift(anchors: readonly Anchor[], cur: Gray, opt: DriftOptions = {}): DriftMeasure {
  const f = Math.max(1, cur.width / (opt.workWidth ?? 512));
  const g = downscale(cur, f);
  const R = opt.searchPx ?? 8;
  const dxs: number[] = [], dys: number[] = [];
  let usable = 0, good = 0;
  for (const a of anchors) {
    const masked = (opt.maskBoxes ?? []).some((b) => a.u >= b[0] && a.u <= b[2] && a.v >= b[1] && a.v <= b[3]);
    if (masked) continue;
    usable++;
    const cx = a.u * g.width, cy = a.v * g.height;
    let best = -2, bx = 0, by = 0;
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      const v = nccPatch(g, cx + ox, cy + oy, a);
      if (v > best) { best = v; bx = ox; by = oy; }
    }
    if (best >= 0.6) {
      good++;
      // Subpixel (parabolisch) in x und y
      const s = (ox: number, oy: number): number => nccPatch(g, cx + ox, cy + oy, a);
      const sx = (() => { const l = s(bx - 1, by), c = best, r = s(bx + 1, by); const d = l - 2 * c + r; return Math.abs(d) > 1e-9 ? (0.5 * (l - r)) / d : 0; })();
      const sy = (() => { const l = s(bx, by - 1), c = best, r = s(bx, by + 1); const d = l - 2 * c + r; return Math.abs(d) > 1e-9 ? (0.5 * (l - r)) / d : 0; })();
      dxs.push((bx + sx) / g.width); dys.push((by + sy) / g.height);
    }
  }
  const med = (a: number[]): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] as number; };
  const dx = med(dxs), dy = med(dys), betrag = Math.hypot(dx, dy);
  const sichtbar = anchors.length ? usable / anchors.length : 0, gueltig = usable ? good / usable : 0;
  let status: DriftMeasure['status'] = 'ok';
  if (sichtbar < 0.5 || gueltig < 0.5 || betrag > DRIFT_LOST) status = 'verloren';
  else if (betrag > DRIFT_WARN || gueltig < 0.75) status = 'warnung';
  return { dx, dy, betrag, sichtbar, gueltig, status };
}

export { newGray };
