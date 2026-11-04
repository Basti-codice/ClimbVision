import { describe, expect, it } from 'vitest';
import {
  applyH, checkCornerQuad, homographyFromPoints, inv3, isConvexQuad, mul3, reprojectionError, wallHomographyFromCorners,
  type Mat3, type Vec2,
} from '../src/geometry/homography';
import {
  area, bbox, centroid, clipHalfPlane, compactness, convexHull, mergePolygons, pointInPolygon, signedDistance, simplify, splitPolygon,
} from '../src/geometry/polygon';
import { OneEuro1D } from '../src/geometry/oneEuro';

describe('Homographie', () => {
  it('Identität aus identischen Punkten', () => {
    const q: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const h = homographyFromPoints(q, q);
    for (const p of q) { const r = applyH(h, p); expect(r[0]).toBeCloseTo(p[0], 9); expect(r[1]).toBeCloseTo(p[1], 9); }
  });
  it('bekannte Perspektive: Roundtrip exakt auf 4 Punkten, und auf inneren Punkten', () => {
    const truth: Mat3 = [0.9, 0.1, 30, -0.05, 1.1, 12, 0.0004, -0.0002, 1];
    const src: Vec2[] = [[100, 80], [900, 60], [950, 700], [60, 760]];
    const dst = src.map((p) => applyH(truth, p));
    const h = homographyFromPoints(src, dst);
    expect(reprojectionError(h, src, dst)).toBeLessThan(1e-6);
    const p: Vec2 = [480, 400];
    const a = applyH(truth, p), b = applyH(h, p);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
  });
  it('H · H⁻¹ = I', () => {
    const h = wallHomographyFromCorners([[120, 90], [980, 70], [1010, 720], [80, 760]]);
    const m = mul3(h, inv3(h));
    for (let i = 0; i < 9; i++) expect(m[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 9);
  });
  it('Wandecken landen auf (0,0),(1,0),(1,1),(0,1)', () => {
    const c: Vec2[] = [[120, 90], [980, 70], [1010, 720], [80, 760]];
    const h = wallHomographyFromCorners(c);
    const exp: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    c.forEach((p, i) => { const r = applyH(h, p); expect(r[0]).toBeCloseTo((exp[i] as Vec2)[0], 9); expect(r[1]).toBeCloseTo((exp[i] as Vec2)[1], 9); });
  });
  it('Least-Squares mit >4 verrauschten Punkten bleibt nahe an der Wahrheit', () => {
    const truth: Mat3 = [1.05, 0.02, 10, -0.01, 0.97, -5, 0.0001, 0.00005, 1];
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    const src: Vec2[] = []; for (let i = 0; i < 40; i++) src.push([rnd() * 1000 + 500, rnd() * 800 + 400]);
    const dst = src.map((p) => { const q = applyH(truth, p); return [q[0] + rnd() * 0.5, q[1] + rnd() * 0.5] as Vec2; });
    const h = homographyFromPoints(src, dst);
    expect(reprojectionError(h, src, dst)).toBeLessThan(1.0);
  });
  it('lehnt kollineare Punkte ab', () => {
    expect(() => homographyFromPoints([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [1, 1], [0, 1]])).toThrow();
    expect(() => homographyFromPoints([[0, 0], [1, 0], [1, 1]], [[0, 0], [1, 0], [1, 1]])).toThrow();
  });
  it('Eckprüfung: konvex, Mindestfläche, Reihenfolge', () => {
    expect(checkCornerQuad([[100, 100], [900, 100], [900, 700], [100, 700]], 1000, 800).ok).toBe(true);
    expect(isConvexQuad([[0, 0], [10, 0], [2, 2], [0, 10]])).toBe(false); // nicht konvex
    expect(checkCornerQuad([[100, 100], [110, 100], [110, 110], [100, 110]], 1000, 800)).toEqual({ ok: false, grund: 'zu_klein' });
    expect(checkCornerQuad([[100, 100], [100, 700], [900, 700], [900, 100]], 1000, 800)).toEqual({ ok: false, grund: 'reihenfolge' });
    expect(checkCornerQuad([[0, 0], [100, 100], [100, 0], [0, 100]], 200, 200).ok).toBe(false); // Schleife
  });
});

describe('Polygon', () => {
  const sq: Vec2[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
  const L: Vec2[] = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]]; // konkav
  it('Fläche, Schwerpunkt, BBox', () => {
    expect(area(sq)).toBe(16);
    expect(centroid(sq)).toEqual([2, 2]);
    expect(bbox(L)).toEqual([0, 0, 4, 4]);
    expect(area(L)).toBe(12);
  });
  it('Punkt-in-Polygon: innen, außen, Rand, konkav', () => {
    expect(pointInPolygon([2, 2], sq)).toBe(true);
    expect(pointInPolygon([5, 2], sq)).toBe(false);
    expect(pointInPolygon([4, 2], sq)).toBe(true); // Rand
    expect(pointInPolygon([0, 0], sq)).toBe(true); // Ecke
    expect(pointInPolygon([3, 3], L)).toBe(false); // in der Einbuchtung
    expect(pointInPolygon([1, 3], L)).toBe(true);
  });
  it('Signed Distance: innen negativ, außen positiv', () => {
    expect(signedDistance([2, 2], sq)).toBeCloseTo(-2, 9);
    expect(signedDistance([6, 2], sq)).toBeCloseTo(2, 9);
    expect(signedDistance([6, 6], sq)).toBeCloseTo(Math.SQRT2 * 2, 9);
    expect(signedDistance([4, 2], sq)).toBeCloseTo(0, 9);
  });
  it('Vereinfachung entfernt kollineare Punkte, erhält Form', () => {
    const dense: Vec2[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 4], [0, 4]];
    const s = simplify(dense, 0.01);
    expect(s.length).toBe(4);
    expect(area(s)).toBeCloseTo(16, 9);
  });
  it('Konvexe Hülle / Zusammenführen', () => {
    const m = mergePolygons([[0, 0], [2, 0], [2, 2], [0, 2]], [[3, 0], [5, 0], [5, 2], [3, 2]]);
    expect(area(m)).toBeCloseTo(10, 9);
    expect(convexHull(L).length).toBe(5);
  });
  it('Teilen entlang einer Geraden', () => {
    const r = splitPolygon(sq, [2, -1], [2, 5]);
    expect(r).not.toBeNull();
    expect(area(r![0]) + area(r![1])).toBeCloseTo(16, 9);
    expect(area(r![0])).toBeCloseTo(8, 9);
    expect(splitPolygon(sq, [10, -1], [10, 5])).toBeNull(); // Gerade außerhalb
    expect(clipHalfPlane(sq, [1, 0], 2).length).toBe(4);
  });
  it('Kompaktheit: Quadrat < Kreis-Näherung', () => {
    const circle: Vec2[] = Array.from({ length: 64 }, (_, i) => [Math.cos((i / 64) * 2 * Math.PI), Math.sin((i / 64) * 2 * Math.PI)]);
    expect(compactness(circle)).toBeGreaterThan(0.99);
    expect(compactness(sq)).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe('One-Euro-Filter', () => {
  it('Konstantes Signal bleibt konstant', () => {
    const f = new OneEuro1D();
    for (let t = 0; t < 1000; t += 33) expect(f.filter(5, t)).toBeCloseTo(5, 9);
  });
  it('dämpft Rauschen im Stillstand', () => {
    const f = new OneEuro1D({ minCutoff: 1, beta: 0, dCutoff: 1 });
    let seed = 3; const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    let rawVar = 0, outVar = 0, n = 0;
    for (let t = 0; t < 10000; t += 33) { const v = rnd(); const o = f.filter(v, t); if (t > 1000) { rawVar += v * v; outVar += o * o; n++; } }
    expect(outVar / n).toBeLessThan(0.4 * (rawVar / n));
  });
  it('folgt Sprung schnell (beta) und ist bei ungleichmäßigem dt stabil', () => {
    const f = new OneEuro1D({ minCutoff: 1, beta: 5, dCutoff: 1 });
    for (let t = 0; t < 500; t += 33) f.filter(0, t);
    let o = 0; for (const t of [533, 600, 700, 710, 900]) o = f.filter(1, t);
    expect(o).toBeGreaterThan(0.9);
    expect(Number.isFinite(f.filter(1, 900))).toBe(true); // dt = 0 darf nicht NaN erzeugen
  });
});
