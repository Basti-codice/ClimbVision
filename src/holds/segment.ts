/**
 * Klassische Griff-Segmentierung (ohne ML): arbeitet auf dem ENTZERRTEN Wandbild.
 * Pipeline: Graubild → Otsu + lokaler Kontrast → Morphologie → Löcher füllen → Zusammenhangskomponenten
 *           → Distanztransformation + Persistenz-Watershed (trennt berührende Griffe) → Kontur → Vereinfachung.
 * Stärke: helle/farbige Griffe auf einheitlichem Hintergrund. Schwäche: gleichfarbige Griffe, starke Reflexionen.
 */
import { boxBlur, gaussBlur, toGray, type Gray, type Rgba } from '../image/raster';
import { area, compactness, simplify } from '../geometry/polygon';
import type { Vec2 } from '../geometry/homography';

export interface SegmentOptions {
  /** 'hell': Griffe heller als Wand, 'dunkel': dunkler, 'auto': über Randstatistik. */
  polarity: 'auto' | 'hell' | 'dunkel';
  /** Mindest-/Maximalfläche relativ zur Wandfläche. */
  minAreaFrac: number;
  maxAreaFrac: number;
  /** Radius des lokalen Kontrastfensters relativ zur Bildbreite. */
  localRadiusFrac: number;
  /** Mindest-Kontrast (Graustufen) gegenüber dem lokalen Mittel. */
  localContrast: number;
  /** Morphologie-Öffnungsradius in Pixeln (entfernt Kreidelinien). */
  openRadius: number;
  /** Persistenz-Schwelle fürs Trennen berührender Griffe (relativ zum Peak, mind. absolut). */
  splitRel: number;
  splitMinAbs: number;
  /** Mindest-Kompaktheit (4πA/P²), filtert Linien/Schrift. */
  minCompactness: number;
  /** Vereinfachungs-Epsilon in Pixeln. */
  simplifyEps: number;
  onProgress?: (fraction: number, schritt: string) => void;
}

export const DEFAULT_SEGMENT_OPTIONS: SegmentOptions = {
  polarity: 'auto',
  minAreaFrac: 0.00006,
  maxAreaFrac: 0.012,
  localRadiusFrac: 0.045,
  localContrast: 6,
  openRadius: 2,
  splitRel: 0.28,
  splitMinAbs: 1.5,
  minCompactness: 0.28,
  simplifyEps: 1.1,
};

export interface SegmentResult {
  /** Polygone in NORMALISIERTEN Wandkoordinaten (0..1). */
  polygons: Vec2[][];
  maskPixels: number;
  schwelle: number;
  polaritaet: 'hell' | 'dunkel';
  /** Binärmaske (Debug). */
  mask: Uint8Array;
  labels: Int32Array;
  width: number;
  height: number;
}

export function otsu(g: Gray): number {
  const hist = new Float64Array(256);
  for (const v of g.data) hist[Math.max(0, Math.min(255, Math.round(v)))]! += 1;
  const total = g.data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] as number);
  let wB = 0, sumB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] as number;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] as number);
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** Separable Quadrat-Erosion/-Dilatation mit Radius r. */
function morph(src: Uint8Array, w: number, h: number, r: number, mode: 'erode' | 'dilate'): Uint8Array {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const want = mode === 'dilate' ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = mode === 'erode' ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        const v = xx < 0 || xx >= w ? (mode === 'erode' ? 1 : 0) : (src[y * w + xx] as number);
        if (v === want) { hit = want; break; }
      }
      tmp[y * w + x] = hit;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = mode === 'erode' ? 1 : 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        const v = yy < 0 || yy >= h ? (mode === 'erode' ? 1 : 0) : (tmp[yy * w + x] as number);
        if (v === want) { hit = want; break; }
      }
      out[y * w + x] = hit;
    }
  return out;
}
export const erode = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => morph(m, w, h, r, 'erode');
export const dilate = (m: Uint8Array, w: number, h: number, r: number): Uint8Array => morph(m, w, h, r, 'dilate');

/** Füllt Löcher (Hintergrundkomponenten, die den Rand nicht berühren und kleiner als maxHole sind). */
export function fillHoles(mask: Uint8Array, w: number, h: number, maxHole: number): Uint8Array {
  const out = Uint8Array.from(mask);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let s = 0; s < w * h; s++) {
    if (mask[s] || seen[s]) continue;
    let sp = 0, count = 0, touches = false;
    const comp: number[] = [];
    stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp] as number;
      comp.push(p); count++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && !mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (!touches && count <= maxHole) for (const p of comp) out[p] = 1;
  }
  return out;
}

/** 8er-Zusammenhangskomponenten. Rückgabe: Label-Bild (0 = Hintergrund) und Anzahl. */
export function connectedComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(w * h);
  const stack = new Int32Array(w * h);
  let count = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || labels[s]) continue;
    count++;
    let sp = 0;
    stack[sp++] = s; labels[s] = count;
    while (sp) {
      const p = stack[--sp] as number;
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (mask[q] && !labels[q]) { labels[q] = count; stack[sp++] = q; }
        }
    }
  }
  return { labels, count };
}

/** Chamfer-Distanztransformation (3-4), Ergebnis in Pixeln (≈ euklidisch). Hintergrund = 0. */
export function distanceTransform(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i] as number;
      if (x > 0) v = Math.min(v, (d[i - 1] as number) + 3);
      if (y > 0) {
        v = Math.min(v, (d[i - w] as number) + 3);
        if (x > 0) v = Math.min(v, (d[i - w - 1] as number) + 4);
        if (x < w - 1) v = Math.min(v, (d[i - w + 1] as number) + 4);
      }
      d[i] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i] as number;
      if (x < w - 1) v = Math.min(v, (d[i + 1] as number) + 3);
      if (y < h - 1) {
        v = Math.min(v, (d[i + w] as number) + 3);
        if (x < w - 1) v = Math.min(v, (d[i + w + 1] as number) + 4);
        if (x > 0) v = Math.min(v, (d[i + w - 1] as number) + 4);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i] as number, 1e6) / 3;
  return d;
}

/**
 * Persistenz-Watershed auf der Distanzkarte: Pixel werden absteigend nach Distanz verarbeitet;
 * zwei Becken verschmelzen, wenn der Sattel nicht tief genug unter dem niedrigeren Gipfel liegt.
 * Trennt berührende Griffe (Einschnürung), lässt längliche Griffe ohne Einschnürung ganz.
 * Gibt für jedes Maskenpixel ein Label (ab 1) zurück.
 */
export function splitByWatershed(mask: Uint8Array, w: number, h: number, dt: Float32Array, rel: number, minAbs: number): Int32Array {
  const idx: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i);
  idx.sort((a, b) => (dt[b] as number) - (dt[a] as number));
  const parent = new Int32Array(w * h).fill(-1); // Union-Find auf Pixelindizes, -1 = unbesucht
  const peak = new Float32Array(w * h);
  const find = (a: number): number => { while ((parent[a] as number) !== a) { parent[a] = parent[parent[a] as number] as number; a = parent[a] as number; } return a; };
  const nbrs = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  for (const p of idx) {
    const x = p % w;
    const roots: number[] = [];
    for (const o of nbrs) {
      const q = p + o;
      if (q < 0 || q >= w * h) continue;
      const qx = q % w;
      if (Math.abs(qx - x) > 1) continue;
      if ((parent[q] as number) === -1) continue;
      const r = find(q);
      if (!roots.includes(r)) roots.push(r);
    }
    const v = dt[p] as number;
    if (roots.length === 0) { parent[p] = p; peak[p] = v; continue; }
    roots.sort((a, b) => (peak[b] as number) - (peak[a] as number));
    const main = roots[0] as number;
    parent[p] = main;
    for (let k = 1; k < roots.length; k++) {
      const r = roots[k] as number;
      const lowPeak = peak[r] as number;
      if (lowPeak - v < Math.max(minAbs, rel * lowPeak)) parent[r] = main; // flacher Sattel → verschmelzen
    }
  }
  const labels = new Int32Array(w * h);
  const ids = new Map<number, number>();
  for (const p of idx) {
    const r = find(p);
    let id = ids.get(r);
    if (id === undefined) { id = ids.size + 1; ids.set(r, id); }
    labels[p] = id;
  }
  return labels;
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

/** Moore-Konturverfolgung des Labels L ab dem ersten Pixel (Rasterreihenfolge). Liefert Pixelmittelpunkte. */
export function traceContour(labels: Int32Array, w: number, h: number, L: number, sx: number, sy: number): Vec2[] {
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === L;
  const pts: Vec2[] = [];
  let cx = sx, cy = sy, back = 4; // Startpixel ist das erste in Rasterreihenfolge: Westen/Norden sind Hintergrund
  let firstMove = -1;
  const limit = 4 * (w + h) * 4 + 64; // Schutz gegen Endlosschleifen
  for (let it = 0; it < limit; it++) {
    let found = -1, nx = 0, ny = 0, nb = 0;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) % 8;
      const x2 = cx + (DX[d] as number), y2 = cy + (DY[d] as number);
      if (!inside(x2, y2)) continue;
      found = d; nx = x2; ny = y2;
      const pd = (d + 7) % 8; // zuletzt geprüftes Hintergrundpixel
      const bx = cx + (DX[pd] as number) - nx, by = cy + (DY[pd] as number) - ny;
      for (let e = 0; e < 8; e++) if (DX[e] === bx && DY[e] === by) nb = e;
      break;
    }
    if (found === -1) { pts.push([cx, cy]); return pts; } // Einzelpixel
    // Jacob-Kriterium: Startpixel erneut erreicht und die nächste Bewegung wäre die erste → fertig
    if (pts.length > 0 && cx === sx && cy === sy && found === firstMove) return pts;
    pts.push([cx, cy]);
    if (firstMove === -1) firstMove = found;
    cx = nx; cy = ny; back = nb;
  }
  return pts;
}

export function segmentHolds(img: Rgba, partial: Partial<SegmentOptions> = {}): SegmentResult {
  const o: SegmentOptions = { ...DEFAULT_SEGMENT_OPTIONS, ...partial };
  const prog = (f: number, s: string): void => o.onProgress?.(f, s);
  const { width: w, height: h } = img;
  prog(0.02, 'Graubild');
  const gray = toGray(img);
  const sm = gaussBlur(gray, 1.0);

  // Polarität: die Wand ist die Klasse (nach Otsu-Trennung) mit der kleineren Streuung – sie ist gleichmäßig,
  // Griffe sind vielfältig. (Eine "Minderheits"-Regel versagt auf dichten Wänden, wo Griffe >50 % der Fläche bedecken.)
  let polarity: 'hell' | 'dunkel';
  if (o.polarity === 'auto') {
    const t0 = otsu(sm);
    let n1 = 0, s1 = 0, q1 = 0, n2 = 0, s2 = 0, q2 = 0;
    for (const v of sm.data) {
      if (v > t0) { n1++; s1 += v; q1 += v * v; } else { n2++; s2 += v; q2 += v * v; }
    }
    const sd = (n: number, s: number, q: number): number => (n ? Math.sqrt(Math.max(0, q / n - (s / n) ** 2)) : 0);
    polarity = sd(n2, s2, q2) <= sd(n1, s1, q1) ? 'hell' : 'dunkel'; // dunkle Klasse gleichmäßiger → dunkle Wand → helle Griffe
  } else polarity = o.polarity;
  const work: Gray = polarity === 'hell' ? sm : { width: w, height: h, data: sm.data.map((v) => 255 - v) };

  prog(0.1, 'Schwellwert');
  const thr = otsu(work);
  const r = Math.max(6, Math.round(o.localRadiusFrac * w));
  const localMean = boxBlur(work, r);
  let mask: Uint8Array = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = (work.data[i] as number) > thr && (work.data[i] as number) > (localMean.data[i] as number) + o.localContrast ? 1 : 0;

  prog(0.3, 'Morphologie');
  if (o.openRadius > 0) { mask = erode(mask, w, h, o.openRadius); mask = dilate(mask, w, h, o.openRadius); }
  mask = dilate(mask, w, h, 1); mask = erode(mask, w, h, 1); // Schließen kleiner Lücken
  const wallArea = w * h;
  mask = fillHoles(mask, w, h, Math.round(0.0004 * wallArea));

  prog(0.45, 'Komponenten');
  const cc = connectedComponents(mask, w, h);
  const compArea = new Int32Array(cc.count + 1);
  for (const l of cc.labels) if (l) compArea[l]!++;
  const minA = o.minAreaFrac * wallArea, maxA = o.maxAreaFrac * wallArea;
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < keep.length; i++) { const l = cc.labels[i] as number; if (l && (compArea[l] as number) >= minA) keep[i] = 1; }

  prog(0.55, 'Trennen berührender Griffe');
  const dt = distanceTransform(keep, w, h);
  const ws = splitByWatershed(keep, w, h, dt, o.splitRel, o.splitMinAbs);

  prog(0.75, 'Konturen');
  const wsCount = ws.reduce((a, b) => (b > a ? b : a), 0);
  const first = new Int32Array(wsCount + 1).fill(-1);
  const wsArea = new Int32Array(wsCount + 1);
  for (let i = 0; i < ws.length; i++) { const l = ws[i] as number; if (l) { wsArea[l]!++; if (first[l] === -1) first[l] = i; } }
  const polygons: Vec2[][] = [];
  for (let l = 1; l <= wsCount; l++) {
    if ((wsArea[l] as number) < minA || (wsArea[l] as number) > maxA) continue;
    const s = first[l] as number;
    const contour = traceContour(ws, w, h, l, s % w, (s / w) | 0);
    if (contour.length < 6) continue;
    const poly = simplify(contour, o.simplifyEps);
    if (poly.length < 3 || compactness(poly) < o.minCompactness || area(poly) < minA * 0.6) continue;
    polygons.push(poly.map((p) => [(p[0] + 0.5) / w, (p[1] + 0.5) / h] as Vec2));
  }
  prog(1, 'Fertig');
  return { polygons, maskPixels: keep.reduce((a, b) => a + b, 0), schwelle: thr, polaritaet: polarity, mask: keep, labels: ws, width: w, height: h };
}

/**
 * Zauberstab: wächst ab einem Klickpunkt (u,v normalisiert) über Pixel, deren Helligkeit/Farbe nahe am Startwert liegt.
 * Liefert das Konturpolygon (normalisiert) oder null. Gedacht für den Editor ("Klick → Polygon").
 */
export function magicWand(img: Rgba, u: number, v: number, tolerance = 28, maxAreaFrac = 0.02): Vec2[] | null {
  const { width: w, height: h, data: d } = img;
  const sx = Math.max(0, Math.min(w - 1, Math.round(u * w))), sy = Math.max(0, Math.min(h - 1, Math.round(v * h)));
  // Startfarbe: Mittel über 5×5 (robust gegen die Schraube/Maserung in der Griffmitte)
  let r0 = 0, g0 = 0, b0 = 0, n0 = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) { const o = (y * w + x) * 4; r0 += d[o] as number; g0 += d[o + 1] as number; b0 += d[o + 2] as number; n0++; }
  r0 /= n0; g0 /= n0; b0 /= n0;
  const maxA = maxAreaFrac * w * h;
  const mask = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0, count = 0;
  const ok = (i: number): boolean => { const o = i * 4; return Math.hypot((d[o] as number) - r0, (d[o + 1] as number) - g0, (d[o + 2] as number) - b0) <= tolerance * 1.73; };
  const start = sy * w + sx;
  if (!ok(start)) return null;
  stack[sp++] = start; mask[start] = 1;
  while (sp) {
    const p = stack[--sp] as number; count++;
    if (count > maxA) return null; // ausgelaufen (Toleranz zu hoch)
    const x = p % w, y = (p / w) | 0;
    if (x > 0 && !mask[p - 1] && ok(p - 1)) { mask[p - 1] = 1; stack[sp++] = p - 1; }
    if (x < w - 1 && !mask[p + 1] && ok(p + 1)) { mask[p + 1] = 1; stack[sp++] = p + 1; }
    if (y > 0 && !mask[p - w] && ok(p - w)) { mask[p - w] = 1; stack[sp++] = p - w; }
    if (y < h - 1 && !mask[p + w] && ok(p + w)) { mask[p + w] = 1; stack[sp++] = p + w; }
  }
  if (count < 12) return null;
  let m: Uint8Array = fillHoles(mask, w, h, Math.round(0.0004 * w * h));
  m = erode(m, w, h, 1); m = dilate(m, w, h, 1); // Ausfransungen glätten
  const cc = connectedComponents(m, w, h);
  const lab = cc.labels[start] || cc.labels.find((l) => l > 0) || 0;
  if (!lab) return null;
  let first = -1; for (let i = 0; i < cc.labels.length; i++) if (cc.labels[i] === lab) { first = i; break; }
  const contour = traceContour(cc.labels, w, h, lab, first % w, (first / w) | 0);
  if (contour.length < 6) return null;
  const poly = simplify(contour, 1.1);
  return poly.length >= 3 ? poly.map((p) => [(p[0] + 0.5) / w, (p[1] + 0.5) / h] as Vec2) : null;
}
