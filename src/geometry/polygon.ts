/** Polygon-Geometrie in beliebigen (konsistent skalierten) Koordinaten. */
import type { Vec2 } from './homography';

export type Polygon = Vec2[];
export type BBox = [number, number, number, number]; // x0,y0,x1,y1

export function signedArea(p: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i] as Vec2, r = p[(i + 1) % p.length] as Vec2;
    a += q[0] * r[1] - r[0] * q[1];
  }
  return a / 2;
}
export const area = (p: readonly Vec2[]): number => Math.abs(signedArea(p));

export function centroid(p: readonly Vec2[]): Vec2 {
  const a = signedArea(p);
  if (Math.abs(a) < 1e-15) {
    let sx = 0, sy = 0;
    for (const q of p) { sx += q[0]; sy += q[1]; }
    return [sx / Math.max(1, p.length), sy / Math.max(1, p.length)];
  }
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i] as Vec2, r = p[(i + 1) % p.length] as Vec2;
    const f = q[0] * r[1] - r[0] * q[1];
    cx += (q[0] + r[0]) * f;
    cy += (q[1] + r[1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function bbox(p: readonly Vec2[]): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  return [x0, y0, x1, y1];
}

/** Ray-Casting. Punkte exakt auf dem Rand zählen als innen. */
export function pointInPolygon(pt: Vec2, poly: readonly Vec2[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Vec2, b = poly[j] as Vec2;
    if (distToSegment(pt, a, b) < 1e-12) return true;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Vorzeichenbehafteter Abstand: negativ innen, positiv außen (0 auf dem Rand). */
export function signedDistance(pt: Vec2, poly: readonly Vec2[]): number {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) d = Math.min(d, distToSegment(pt, poly[i] as Vec2, poly[(i + 1) % poly.length] as Vec2));
  return pointInPolygon(pt, poly) ? -d : d;
}

export function scalePolygon(p: readonly Vec2[], sx: number, sy: number): Polygon {
  return p.map((q) => [q[0] * sx, q[1] * sy] as Vec2);
}
export function translatePolygon(p: readonly Vec2[], dx: number, dy: number): Polygon {
  return p.map((q) => [q[0] + dx, q[1] + dy] as Vec2);
}

/** Douglas-Peucker für geschlossene Polygone (Epsilon in Koordinateneinheiten). */
export function simplify(poly: readonly Vec2[], eps: number): Polygon {
  if (poly.length <= 3) return [...poly];
  // Start: zwei weit entfernte Punkte
  const i0 = 0; let i1 = 0, best = -1;
  for (let i = 1; i < poly.length; i++) {
    const d = Math.hypot((poly[i] as Vec2)[0] - (poly[0] as Vec2)[0], (poly[i] as Vec2)[1] - (poly[0] as Vec2)[1]);
    if (d > best) { best = d; i1 = i; }
  }
  const rec = (pts: readonly Vec2[], s: number, e: number, keep: boolean[]): void => {
    if (e <= s + 1) return;
    let md = -1, mi = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i] as Vec2, pts[s] as Vec2, pts[e] as Vec2);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi >= 0) { keep[mi] = true; rec(pts, s, mi, keep); rec(pts, mi, e, keep); }
  };
  const keep = new Array<boolean>(poly.length).fill(false);
  keep[i0] = true; keep[i1] = true;
  rec(poly, i0, i1, keep);
  const second = [...poly.slice(i1), poly[0] as Vec2];
  const keep2 = new Array<boolean>(second.length).fill(false);
  keep2[0] = true; keep2[second.length - 1] = true;
  rec(second, 0, second.length - 1, keep2);
  const out: Polygon = [];
  for (let i = i0; i <= i1; i++) if (keep[i]) out.push(poly[i] as Vec2);
  for (let i = 1; i < second.length - 1; i++) if (keep2[i]) out.push(second[i] as Vec2);
  return out.length >= 3 ? out : [...poly.slice(0, 3)];
}

/** Konvexe Hülle (Andrew's monotone chain). */
export function convexHull(pts: readonly Vec2[]): Polygon {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2] as Vec2, lo[lo.length - 1] as Vec2, q) <= 0) lo.pop(); lo.push(q); }
  const up: Vec2[] = [];
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2] as Vec2, up[up.length - 1] as Vec2, q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return [...lo, ...up];
}

/** Schneidet ein Polygon mit der Halbebene n·x ≥ c (Sutherland–Hodgman; exakt für konvexe, brauchbar für leicht konkave Polygone). */
export function clipHalfPlane(poly: readonly Vec2[], n: Vec2, c: number): Polygon {
  const out: Polygon = [];
  const f = (p: Vec2): number => n[0] * p[0] + n[1] * p[1] - c;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i] as Vec2, b = poly[(i + 1) % poly.length] as Vec2;
    const fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/** Teilt ein Polygon entlang der Geraden durch a und b in zwei Teile (leer, wenn Gerade das Polygon nicht schneidet). */
export function splitPolygon(poly: readonly Vec2[], a: Vec2, b: Vec2): [Polygon, Polygon] | null {
  const n: Vec2 = [-(b[1] - a[1]), b[0] - a[0]];
  const c = n[0] * a[0] + n[1] * a[1];
  const left = clipHalfPlane(poly, n, c);
  const right = clipHalfPlane(poly, [-n[0], -n[1]], -c);
  if (left.length < 3 || right.length < 3 || area(left) < 1e-12 || area(right) < 1e-12) return null;
  return [left, right];
}

export function mergePolygons(a: readonly Vec2[], b: readonly Vec2[]): Polygon {
  return convexHull([...a, ...b]);
}

/** Kompaktheit 4πA/P² (Kreis = 1). */
export function compactness(p: readonly Vec2[]): number {
  let per = 0;
  for (let i = 0; i < p.length; i++) per += Math.hypot((p[i] as Vec2)[0] - (p[(i + 1) % p.length] as Vec2)[0], (p[i] as Vec2)[1] - (p[(i + 1) % p.length] as Vec2)[1]);
  return per < 1e-12 ? 0 : (4 * Math.PI * area(p)) / (per * per);
}
