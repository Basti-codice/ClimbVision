import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { z } from 'zod';
import { HoldSchema, HoldsFileSchema, SCHEMA_VERSION, jsonSchemas } from '../src/core/schemas';
import { migrate, MigrationError } from '../src/core/migrate';
import { History, addPolygon, autoNumber, deleteHolds, filterBySize, makeHold, mergeHolds, moveHold, moveVertex, splitHold, updateHold } from '../src/holds/editor';
import { segmentHolds, otsu, distanceTransform, splitByWatershed, connectedComponents, fillHoles } from '../src/holds/segment';
import { toGray } from '../src/image/raster';
import { area, pointInPolygon } from '../src/geometry/polygon';
import type { Vec2 } from '../src/geometry/homography';
import { loadJpeg, syntheticWall } from './helpers';
import { resizeRgba, warpToWall } from '../src/image/raster';
import { wallHomographyFromCorners } from '../src/geometry/homography';

const sq = (x: number, y: number, s: number): Vec2[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];

describe('Editor', () => {
  const base = [makeHold(1, sq(0.1, 0.1, 0.05), 'auto', 0.0025), makeHold(2, sq(0.3, 0.1, 0.05), 'auto', 0.0025), makeHold(3, sq(0.1, 0.4, 0.05), 'auto', 0.0025)];
  it('makeHold berechnet Geometriefelder', () => {
    const h = base[0]!;
    expect(h.flaeche).toBeCloseTo(0.0025, 9);
    expect(h.schwerpunkt[0]).toBeCloseTo(0.125, 9);
    expect(h.bbox[0]).toBeCloseTo(0.1, 9); expect(h.bbox[3]).toBeCloseTo(0.15, 9);
    expect(HoldSchema.safeParse(h).success).toBe(true);
  });
  it('löschen / hinzufügen / ändern setzt Quelle manuell, Original unverändert', () => {
    const d = deleteHolds(base, new Set([2]));
    expect(d.map((h) => h.id)).toEqual([1, 3]);
    expect(base.length).toBe(3);
    const a = addPolygon(base, sq(0.6, 0.6, 0.04));
    expect(a.at(-1)!.id).toBe(4);
    expect(a.at(-1)!.quelle).toBe('manuell');
    const u = updateHold(base, 1, { tiefe_cm: 5, notiz: 'Sloper' });
    expect(u[0]!.quelle).toBe('manuell');
    expect(u[0]!.tiefe_cm).toBe(5);
  });
  it('verschieben (Polygon und Eckpunkt) aktualisiert Schwerpunkt/BBox', () => {
    const m = moveHold(base, 1, 0.1, 0.2);
    expect(m[0]!.schwerpunkt[0]).toBeCloseTo(0.225, 9);
    expect(m[0]!.bbox[1]).toBeCloseTo(0.3, 9);
    const v = moveVertex(base, 1, 2, [0.2, 0.2]);
    expect(v[0]!.polygon[2]).toEqual([0.2, 0.2]);
    expect(moveVertex(base, 1, 99, [0, 0])).toEqual(base);
  });
  it('zusammenführen: Hülle enthält beide, ein Griff weniger', () => {
    const m = mergeHolds(base, [1, 2]);
    expect(m.length).toBe(2);
    const merged = m.find((h) => h.id === 1)!;
    expect(pointInPolygon([0.125, 0.125], merged.polygon)).toBe(true);
    expect(pointInPolygon([0.325, 0.125], merged.polygon)).toBe(true);
    expect(mergeHolds(base, [1])).toEqual(base);
  });
  it('teilen: Fläche bleibt erhalten, neue ID', () => {
    const big = [makeHold(1, sq(0.1, 0.1, 0.1), 'auto', 0.01)];
    const s = splitHold(big, 1, [0.15, 0.0], [0.15, 1.0]);
    expect(s.length).toBe(2);
    expect(s.reduce((a, h) => a + area(h.polygon), 0)).toBeCloseTo(0.01, 9);
    expect(new Set(s.map((h) => h.id)).size).toBe(2);
    expect(splitHold(big, 1, [0.9, 0], [0.9, 1])).toEqual(big);
  });
  it('Auto-Nummerierung: zeilenweise, links→rechts, IDs lückenlos', () => {
    const shuffled = [base[2]!, base[1]!, base[0]!];
    const n = autoNumber(shuffled);
    expect(n.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(n[0]!.schwerpunkt[0]).toBeLessThan(n[1]!.schwerpunkt[0]);
    expect(n[2]!.schwerpunkt[1]).toBeGreaterThan(n[0]!.schwerpunkt[1]);
    expect(autoNumber([])).toEqual([]);
  });
  it('Größenfilter', () => {
    const mixed = [...base, makeHold(9, sq(0.8, 0.8, 0.005), 'auto', 0.0025)];
    const f = filterBySize(mixed, 0.5, 2);
    expect(f.map((h) => h.id)).not.toContain(9);
  });
  it('History: undo/redo', () => {
    const h = new History<number>(0);
    h.push(1); h.push(2);
    expect(h.undo()).toBe(true); expect(h.present).toBe(1);
    expect(h.redo()).toBe(true); expect(h.present).toBe(2);
    h.undo(); h.push(5);
    expect(h.canRedo).toBe(false);
    expect(new History(0).undo()).toBe(false);
  });
});

describe('Schemas & Migration', () => {
  it('JSON-Schemas werden erzeugt', () => {
    const s = jsonSchemas() as Record<string, { type?: string }>;
    expect(Object.keys(s).sort()).toEqual(['Holds', 'Route', 'Session', 'WallProfile']);
    expect(s['Holds']!.type).toBe('object');
  });
  it('v0-Entwicklungsformat wird auf v1 migriert', () => {
    const old = { holds: [{ id: 1, polygon: [0.1, 0.1, 0.2, 0.1, 0.2, 0.2, 0.1, 0.2], depth_cm: 3, source: 'manual' }, { id: 2, polygon: [0.5, 0.5, 0.6, 0.5, 0.6, 0.6, 0.5, 0.6] }], wallId: 'w1', created: '2025-01-01T00:00:00Z' };
    const r = migrate(old);
    expect(r.vonVersion).toBe(0);
    const doc = r.doc as z.infer<typeof HoldsFileSchema>;
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.griffe[0]!.quelle).toBe('manuell');
    expect(doc.griffe[0]!.tiefe_cm).toBe(3);
    expect(doc.griffe[1]!.quelle).toBe('auto');
    expect(doc.griffe[0]!.flaeche).toBeCloseTo(0.01, 9);
  });
  it('aktuelle Version läuft unverändert durch; neuere Version wird abgelehnt', () => {
    const cur = { schemaVersion: 1, typ: 'Holds', wandId: 'w', erstellt: 'x', griffe: [makeHold(1, sq(0, 0, 0.1), 'auto', 0.01)] };
    expect(migrate(cur).vonVersion).toBe(1);
    expect(() => migrate({ ...cur, schemaVersion: 2 })).toThrow(MigrationError);
    expect(() => migrate({ typ: 'Quark' })).toThrow(MigrationError);
    expect(() => migrate(null)).toThrow(MigrationError);
    expect(() => migrate({ ...cur, griffe: [{ id: 1 }] })).toThrow(MigrationError);
  });
});

describe('Segmentierung (synthetisch)', () => {
  const { img, truth } = syntheticWall(720, 460);
  const r = segmentHolds(img);
  it('findet alle Griffe inkl. berührender Paare, Polarität hell', () => {
    expect(r.polaritaet).toBe('hell');
    expect(r.polygons.length).toBe(truth.length);
  });
  it('jedes Wahrheits-Zentrum liegt in genau einem Polygon', () => {
    for (const t of truth) {
      const hit = r.polygons.filter((p) => pointInPolygon([t.cx / 720, t.cy / 460], p));
      expect(hit.length).toBe(1);
    }
  });
  it('Fläche ≈ Ellipsenfläche (±12 %)', () => {
    for (const t of truth) {
      const p = r.polygons.find((q) => pointInPolygon([t.cx / 720, t.cy / 460], q))!;
      const a = area(p.map((v) => [v[0] * 720, v[1] * 460] as Vec2));
      expect(a / (Math.PI * t.rx * t.ry)).toBeGreaterThan(0.88);
      expect(a / (Math.PI * t.rx * t.ry)).toBeLessThan(1.12);
    }
  });
  it('invertiertes Bild (dunkle Griffe auf heller Wand) → Polarität dunkel, gleiche Anzahl', () => {
    const inv = { ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : 255 - v)) };
    const ri = segmentHolds(inv);
    expect(ri.polaritaet).toBe('dunkel');
    expect(ri.polygons.length).toBe(truth.length);
  });
  it('leere Wand → keine Griffe', () => {
    const d = new Uint8ClampedArray(200 * 200 * 4).fill(40); for (let i = 3; i < d.length; i += 4) d[i] = 255;
    expect(segmentHolds({ width: 200, height: 200, data: d }).polygons.length).toBe(0);
  });
  it('Hilfsfunktionen: Otsu, Distanz, Löcher, Komponenten, Watershed', () => {
    const g = toGray(img);
    const t = otsu(g);
    expect(t).toBeGreaterThanOrEqual(30); expect(t).toBeLessThan(190); // irgendwo in der Lücke zwischen Wand (30–36) und Griff (190+)
    const m = new Uint8Array(100); for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) m[y * 10 + x] = 1; m[5 * 10 + 5] = 0;
    const f = fillHoles(m, 10, 10, 4);
    expect(f[5 * 10 + 5]).toBe(1);
    expect(connectedComponents(f, 10, 10).count).toBe(1);
    const dt = distanceTransform(f, 10, 10);
    expect(Math.max(...dt)).toBeGreaterThan(2);
    const ws = splitByWatershed(f, 10, 10, dt, 0.28, 1.5);
    expect(new Set(ws.filter(Boolean)).size).toBe(1); // einzelner kompakter Block bleibt ganz
  });
  it('Fortschrittsmeldungen laufen von 0 bis 1', () => {
    const seen: number[] = [];
    segmentHolds(img, { onProgress: (f) => seen.push(f) });
    expect(seen[0]).toBeLessThan(0.1);
    expect(seen.at(-1)).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});

const REAL = 'testdata/wall-example.jpg';
describe.skipIf(!fs.existsSync(REAL))('Segmentierung am echten Wandfoto (lokal, testdata/ ist nicht im Repo)', () => {
  it('Kilter-artige Wand: 380–560 Griffe, plausible Größen, <5 s', () => {
    const img = resizeRgba(loadJpeg(REAL), 1134, 2016);
    const k = 1134 / 1125;
    const c = ([[28, 262], [1088, 256], [1116, 1546], [12, 1546]] as Vec2[]).map((p) => [p[0] * k, p[1] * k] as Vec2);
    const rect = warpToWall(img, wallHomographyFromCorners(c), 1060, 1290);
    const t0 = performance.now();
    const r = segmentHolds(rect);
    expect(performance.now() - t0).toBeLessThan(5000);
    expect(r.polygons.length).toBeGreaterThan(380);
    expect(r.polygons.length).toBeLessThan(560);
    const areas = r.polygons.map((p) => area(p) * 1060 * 1290).sort((a, b) => a - b);
    expect(areas[areas.length >> 1]!).toBeGreaterThan(500);
    expect(areas[areas.length >> 1]!).toBeLessThan(2000);
  });
});

import { magicWand } from '../src/holds/segment';
describe('Zauberstab', () => {
  const { img, truth } = syntheticWall(720, 460);
  it('Klick in einen Griff liefert dessen Umriss (Fläche ±12 %)', () => {
    const t = truth[3]!;
    const p = magicWand(img, t.cx / 720, t.cy / 460, 30);
    expect(p).not.toBeNull();
    const a = area(p!.map((v) => [v[0] * 720, v[1] * 460] as Vec2));
    expect(a / (Math.PI * t.rx * t.ry)).toBeGreaterThan(0.85);
    expect(a / (Math.PI * t.rx * t.ry)).toBeLessThan(1.15);
    expect(pointInPolygon([t.cx / 720, t.cy / 460], p!)).toBe(true);
  });
  it('Klick auf die Wand läuft aus → null (Flächengrenze); winzige Fläche → null', () => {
    expect(magicWand(img, 0.005, 0.99, 30, 0.02)).toBeNull();
    const d = new Uint8ClampedArray(40 * 40 * 4).fill(0); for (let i = 3; i < d.length; i += 4) d[i] = 255; d[(20 * 40 + 20) * 4] = 255;
    expect(magicWand({ width: 40, height: 40, data: d }, 0.5, 0.5, 10)).toBeNull();
  });
});
