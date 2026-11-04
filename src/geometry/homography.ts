/** Homographie-Mathematik (DLT mit Hartley-Normalisierung). Rein, ohne Abhängigkeiten. */
export type Vec2 = [number, number];
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r = new Array<number>(9).fill(0) as [number, number, number, number, number, number, number, number, number];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += (a[i * 3 + k] as number) * (b[k * 3 + j] as number);
      r[i * 3 + j] = s;
    }
  return r;
}

export function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function inv3(m: Mat3): Mat3 {
  const d = det3(m);
  if (Math.abs(d) < 1e-14) throw new Error('Matrix ist singulär');
  const [a, b, c, dd, e, f, g, h, i] = m;
  return [
    (e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d,
    (f * g - dd * i) / d, (a * i - c * g) / d, (c * dd - a * f) / d,
    (dd * h - e * g) / d, (b * g - a * h) / d, (a * e - b * dd) / d,
  ];
}

export function normalizeH(m: Mat3): Mat3 {
  const s = m[8];
  if (Math.abs(s) < 1e-12) return m;
  return m.map((x) => x / s) as unknown as Mat3;
}

/** Wendet H auf einen Punkt an. Gibt null zurück, wenn der Punkt im Unendlichen liegt. */
export function applyH(h: Mat3, p: Vec2): Vec2 {
  const w = h[6] * p[0] + h[7] * p[1] + h[8];
  return [(h[0] * p[0] + h[1] * p[1] + h[2]) / w, (h[3] * p[0] + h[4] * p[1] + h[5]) / w];
}

/** Löst A x = b per Gauß-Elimination mit Spaltenpivotisierung. A: n×n (zeilenweise). */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs((M[r] as number[])[c] as number) > Math.abs((M[piv] as number[])[c] as number)) piv = r;
    const pr = M[piv] as number[];
    if (Math.abs(pr[c] as number) < 1e-14) throw new Error('Gleichungssystem singulär');
    M[piv] = M[c] as number[];
    M[c] = pr;
    for (let r = c + 1; r < n; r++) {
      const row = M[r] as number[];
      const f = (row[c] as number) / (pr[c] as number);
      for (let k = c; k <= n; k++) row[k] = (row[k] as number) - f * (pr[k] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = M[r] as number[];
    let s = row[n] as number;
    for (let k = r + 1; k < n; k++) s -= (row[k] as number) * (x[k] as number);
    x[r] = s / (row[r] as number);
  }
  return x;
}

function hartley(pts: readonly Vec2[]): { T: Mat3; out: Vec2[] } {
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  cx /= pts.length; cy /= pts.length;
  let md = 0;
  for (const p of pts) md += Math.hypot(p[0] - cx, p[1] - cy);
  md /= pts.length;
  const s = md > 1e-12 ? Math.SQRT2 / md : 1;
  const T: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  return { T, out: pts.map((p) => [s * (p[0] - cx), s * (p[1] - cy)] as Vec2) };
}

/**
 * Homographie src→dst aus ≥ 4 Punktpaaren (4 exakt, mehr = Least-Squares).
 * Wirft bei entarteter Eingabe (Kollinearität, zu wenige Punkte).
 */
export function homographyFromPoints(src: readonly Vec2[], dst: readonly Vec2[]): Mat3 {
  if (src.length !== dst.length || src.length < 4) throw new Error('Mindestens 4 Punktpaare nötig');
  const ns = hartley(src), nd = hartley(dst);
  const AtA: number[][] = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = ns.out[i] as Vec2;
    const [u, v] = nd.out[i] as Vec2;
    const rows: [number[], number][] = [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ];
    for (const [r, t] of rows)
      for (let a = 0; a < 8; a++) {
        (Atb as number[])[a] = (Atb[a] as number) + (r[a] as number) * t;
        for (let b = 0; b < 8; b++) ((AtA[a] as number[])[b]) = ((AtA[a] as number[])[b] as number) + (r[a] as number) * (r[b] as number);
      }
  }
  let h: number[];
  try { h = solveLinear(AtA, Atb); } catch { throw new Error('Entartete Punktanordnung (z. B. drei Punkte auf einer Linie)'); }
  const Hn: Mat3 = [h[0] as number, h[1] as number, h[2] as number, h[3] as number, h[4] as number, h[5] as number, h[6] as number, h[7] as number, 1];
  // Denormalisierung: H = Td^-1 · Hn · Ts
  const H = mul3(mul3(inv3(nd.T), Hn), ns.T);
  const out = normalizeH(H);
  if (out.some((x) => !Number.isFinite(x))) throw new Error('Homographie nicht berechenbar');
  return out;
}

export function polygonArea2D(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as Vec2, q = pts[(i + 1) % pts.length] as Vec2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function isConvexQuad(q: readonly Vec2[]): boolean {
  if (q.length !== 4) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Vec2, b = q[(i + 1) % 4] as Vec2, c = q[(i + 2) % 4] as Vec2;
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cr) < 1e-9) return false;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export type QuadCheck = { ok: true } | { ok: false; grund: 'nicht_konvex' | 'zu_klein' | 'reihenfolge' };

/** Prüft die vier Wandecken (Reihenfolge TL, TR, BR, BL im Bild; y nach unten). */
export function checkCornerQuad(q: readonly Vec2[], imgW: number, imgH: number): QuadCheck {
  if (q.length !== 4 || !isConvexQuad(q)) return { ok: false, grund: 'nicht_konvex' };
  const area = Math.abs(polygonArea2D(q));
  if (area < 0.02 * imgW * imgH) return { ok: false, grund: 'zu_klein' };
  // Reihenfolge: im Bild (y nach unten) muss TL→TR→BR→BL im Uhrzeigersinn laufen (positive Fläche)
  if (polygonArea2D(q) <= 0) return { ok: false, grund: 'reihenfolge' };
  return { ok: true };
}

/** Homographie Kamera→Wand(0..1) aus vier Bildecken (TL,TR,BR,BL). */
export function wallHomographyFromCorners(corners: readonly Vec2[]): Mat3 {
  return homographyFromPoints(corners, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

/** Maximaler Abstand der Rückprojektion – Qualitätsmaß für die Entzerrung. */
export function reprojectionError(h: Mat3, src: readonly Vec2[], dst: readonly Vec2[]): number {
  let m = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyH(h, src[i] as Vec2), d = dst[i] as Vec2;
    m = Math.max(m, Math.hypot(p[0] - d[0], p[1] - d[1]));
  }
  return m;
}
