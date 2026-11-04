/** Einfache CPU-Rasteroperationen auf RGBA/Graubildern (läuft in Worker, Node-Tests und Main-Thread). */
import { inv3, applyH, type Mat3 } from '../geometry/homography';

export interface Rgba { width: number; height: number; data: Uint8ClampedArray }
export interface Gray { width: number; height: number; data: Float32Array }

export function newGray(width: number, height: number): Gray { return { width, height, data: new Float32Array(width * height) }; }

export function toGray(img: Rgba): Gray {
  const g = newGray(img.width, img.height);
  const d = img.data;
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) g.data[i] = 0.299 * (d[j] as number) + 0.587 * (d[j + 1] as number) + 0.114 * (d[j + 2] as number);
  return g;
}

export function sampleBilinear(g: Gray, x: number, y: number): number {
  if (x < 0 || y < 0 || x > g.width - 1 || y > g.height - 1) return NaN;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0, w = g.width, d = g.data;
  const a = d[y0 * w + x0] as number, b = d[y0 * w + x1] as number, c = d[y1 * w + x0] as number, e = d[y1 * w + x1] as number;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/**
 * Entzerrt ein Kamerabild in den Wandraum: Ausgabepixel (i,j) ↔ Wandkoordinate (i/outW, j/outH).
 * hCamToWall bildet Kamerapixel auf Wand(0..1) ab. Außerhalb liegende Pixel werden schwarz.
 */
export function warpToWall(src: Rgba, hCamToWall: Mat3, outW: number, outH: number): Rgba {
  const inv = inv3(hCamToWall);
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sw = src.width, sh = src.height, sd = src.data;
  for (let j = 0; j < outH; j++)
    for (let i = 0; i < outW; i++) {
      const [x, y] = applyH(inv, [(i + 0.5) / outW, (j + 0.5) / outH]);
      const o = (j * outW + i) * 4;
      const xf = x - 0.5, yf = y - 0.5;
      if (!(xf >= 0 && yf >= 0 && xf <= sw - 1 && yf <= sh - 1)) { out[o + 3] = 255; continue; }
      const x0 = Math.floor(xf), y0 = Math.floor(yf), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const fx = xf - x0, fy = yf - y0;
      for (let c = 0; c < 3; c++) {
        const a = sd[(y0 * sw + x0) * 4 + c] as number, b = sd[(y0 * sw + x1) * 4 + c] as number;
        const e = sd[(y1 * sw + x0) * 4 + c] as number, f = sd[(y1 * sw + x1) * 4 + c] as number;
        out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy;
      }
      out[o + 3] = 255;
    }
  return { width: outW, height: outH, data: out };
}

/** Boxfilter (separabel, Integral-frei) mit Radius r. */
export function boxBlur(g: Gray, r: number): Gray {
  const { width: w, height: h } = g;
  const tmp = newGray(w, h), out = newGray(w, h);
  const k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += g.data[y * w + Math.min(w - 1, Math.max(0, x))] as number;
    for (let x = 0; x < w; x++) {
      tmp.data[y * w + x] = s / k;
      s += (g.data[y * w + Math.min(w - 1, x + r + 1)] as number) - (g.data[y * w + Math.max(0, x - r)] as number);
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp.data[Math.min(h - 1, Math.max(0, y)) * w + x] as number;
    for (let y = 0; y < h; y++) {
      out.data[y * w + x] = s / k;
      s += (tmp.data[Math.min(h - 1, y + r + 1) * w + x] as number) - (tmp.data[Math.max(0, y - r) * w + x] as number);
    }
  }
  return out;
}

/** Gauß-Näherung durch drei Boxfilter. */
export function gaussBlur(g: Gray, sigma: number): Gray {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  return boxBlur(boxBlur(boxBlur(g, r), r), r);
}

/** Verkleinert per Flächenmittelung auf Zielbreite (Faktor ≥ 1). */
export function downscale(g: Gray, factor: number): Gray {
  if (factor <= 1) return g;
  const w = Math.max(1, Math.floor(g.width / factor)), h = Math.max(1, Math.floor(g.height / factor));
  const out = newGray(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * factor), x1 = Math.min(g.width, Math.floor((x + 1) * factor));
      const y0 = Math.floor(y * factor), y1 = Math.min(g.height, Math.floor((y + 1) * factor));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += g.data[yy * g.width + xx] as number; n++; }
      out.data[y * w + x] = n ? s / n : 0;
    }
  return out;
}

export function resizeRgba(img: Rgba, outW: number, outH: number): Rgba {
  const out = new Uint8ClampedArray(outW * outH * 4);
  const sx = img.width / outW, sy = img.height / outH;
  for (let j = 0; j < outH; j++)
    for (let i = 0; i < outW; i++) {
      const x = Math.min(img.width - 1, Math.max(0, (i + 0.5) * sx - 0.5)), y = Math.min(img.height - 1, Math.max(0, (j + 0.5) * sy - 0.5));
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(img.width - 1, x0 + 1), y1 = Math.min(img.height - 1, y0 + 1);
      const fx = x - x0, fy = y - y0;
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c] as number, b = img.data[(y0 * img.width + x1) * 4 + c] as number;
        const e = img.data[(y1 * img.width + x0) * 4 + c] as number, f = img.data[(y1 * img.width + x1) * 4 + c] as number;
        out[(j * outW + i) * 4 + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (e * (1 - fx) + f * fx) * fy;
      }
    }
  return { width: outW, height: outH, data: out };
}

/** Erzeugt out(y) = g(map(y)) mit bilinearer Abtastung; Pixel außerhalb → 0 (valid-Maske separat). */
export function warpGrayBy(g: Gray, map: (x: number, y: number) => readonly [number, number], outW = g.width, outH = g.height): Gray {
  const out = newGray(outW, outH);
  for (let y = 0; y < outH; y++)
    for (let x = 0; x < outW; x++) {
      const [sx, sy] = map(x, y);
      const v = sampleBilinear(g, sx, sy);
      out.data[y * outW + x] = Number.isNaN(v) ? 0 : v;
    }
  return out;
}

export function meanStd(g: Gray): { mean: number; std: number } {
  let s = 0, q = 0;
  for (const v of g.data) { s += v; q += v * v; }
  const n = g.data.length;
  const mean = s / n;
  return { mean, std: Math.sqrt(Math.max(1e-9, q / n - mean * mean)) };
}

/** Normalisiert auf Mittelwert 0 / Standardabweichung 1 (Helligkeits-/Kontrastrobustheit). */
export function normalizeGray(g: Gray): Gray {
  const { mean, std } = meanStd(g);
  const out = newGray(g.width, g.height);
  for (let i = 0; i < g.data.length; i++) out.data[i] = ((g.data[i] as number) - mean) / std;
  return out;
}
