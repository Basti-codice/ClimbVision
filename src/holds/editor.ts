/** Griff-Editor-Operationen: reine Funktionen auf Hold[] (Undo/Redo über History). */
import type { Hold } from '../core/schemas';
import type { Vec2 } from '../geometry/homography';
import { area, bbox, centroid, convexHull, mergePolygons, splitPolygon, translatePolygon } from '../geometry/polygon';

export function makeHold(id: number, polygon: Vec2[], quelle: Hold['quelle'], medianArea: number, extra: Partial<Hold> = {}): Hold {
  const a = area(polygon);
  const h: Hold = {
    id, polygon, schwerpunkt: centroid(polygon), bbox: bbox(polygon), flaeche: a,
    relative_groesse: medianArea > 0 ? a / medianArea : 1, tiefe_cm: 0, quelle,
  };
  return { ...h, ...extra, id, polygon, schwerpunkt: h.schwerpunkt, bbox: h.bbox, flaeche: a };
}

export function medianArea(holds: readonly Hold[]): number {
  const a = holds.map((h) => h.flaeche).sort((x, y) => x - y);
  return a.length ? (a[a.length >> 1] as number) : 0;
}

function renormalize(holds: Hold[]): Hold[] {
  const med = medianArea(holds);
  return holds.map((h) => ({ ...h, relative_groesse: med > 0 ? h.flaeche / med : 1 }));
}

export const nextId = (holds: readonly Hold[]): number => holds.reduce((m, h) => Math.max(m, h.id), 0) + 1;

/** Zeilenweise Nummerierung (oben links → unten rechts); Zeilenhöhe adaptiv aus mittlerer Griffhöhe. */
export function autoNumber(holds: readonly Hold[]): Hold[] {
  if (!holds.length) return [];
  const heights = holds.map((h) => h.bbox[3] - h.bbox[1]).sort((a, b) => a - b);
  const rowH = (heights[heights.length >> 1] as number) * 0.9;
  const sorted = [...holds].sort((a, b) => a.schwerpunkt[1] - b.schwerpunkt[1]);
  const rows: Hold[][] = [];
  let curY = -Infinity;
  for (const h of sorted) {
    if (!rows.length || h.schwerpunkt[1] - curY > rowH) { rows.push([h]); curY = h.schwerpunkt[1]; }
    else { (rows[rows.length - 1] as Hold[]).push(h); const r = rows[rows.length - 1] as Hold[]; curY = r.reduce((s, x) => s + x.schwerpunkt[1], 0) / r.length; }
  }
  const out: Hold[] = [];
  let id = 1;
  for (const r of rows) for (const h of r.sort((a, b) => a.schwerpunkt[0] - b.schwerpunkt[0])) out.push({ ...h, id: id++ });
  return out;
}

export function deleteHolds(holds: readonly Hold[], ids: ReadonlySet<number>): Hold[] { return renormalize(holds.filter((h) => !ids.has(h.id))); }

export function addPolygon(holds: readonly Hold[], polygon: Vec2[]): Hold[] {
  const med = medianArea(holds);
  return renormalize([...holds, makeHold(nextId(holds), polygon, 'manuell', med)]);
}

export function updateHold(holds: readonly Hold[], id: number, patch: Partial<Omit<Hold, 'id'>>): Hold[] {
  return renormalize(holds.map((h) => {
    if (h.id !== id) return h;
    const polygon = patch.polygon ?? h.polygon;
    return { ...h, ...patch, polygon, schwerpunkt: centroid(polygon), bbox: bbox(polygon), flaeche: area(polygon), quelle: 'manuell' as const };
  }));
}

export function moveHold(holds: readonly Hold[], id: number, du: number, dv: number): Hold[] {
  const h = holds.find((x) => x.id === id);
  return h ? updateHold(holds, id, { polygon: translatePolygon(h.polygon, du, dv) }) : [...holds];
}

export function moveVertex(holds: readonly Hold[], id: number, index: number, to: Vec2): Hold[] {
  const h = holds.find((x) => x.id === id);
  if (!h || index < 0 || index >= h.polygon.length) return [...holds];
  const polygon = h.polygon.map((p, i) => (i === index ? to : p));
  return updateHold(holds, id, { polygon });
}

export function mergeHolds(holds: readonly Hold[], ids: readonly number[]): Hold[] {
  const sel = holds.filter((h) => ids.includes(h.id));
  if (sel.length < 2) return [...holds];
  let poly = sel[0]!.polygon;
  for (const h of sel.slice(1)) poly = mergePolygons(poly, h.polygon);
  const keep = holds.filter((h) => !ids.includes(h.id));
  const first = sel[0] as Hold;
  const merged = makeHold(first.id, poly, 'manuell', medianArea(holds), { ...(first.notiz !== undefined ? { notiz: first.notiz } : {}), tiefe_cm: Math.max(...sel.map((h) => h.tiefe_cm)) });
  return renormalize([...keep, merged].sort((a, b) => a.id - b.id));
}

export function splitHold(holds: readonly Hold[], id: number, a: Vec2, b: Vec2): Hold[] {
  const h = holds.find((x) => x.id === id);
  if (!h) return [...holds];
  const parts = splitPolygon(h.polygon, a, b);
  if (!parts) return [...holds];
  const med = medianArea(holds);
  const keep = holds.filter((x) => x.id !== id);
  const first = makeHold(id, parts[0], 'manuell', med, { tiefe_cm: h.tiefe_cm });
  const second = makeHold(nextId(holds), parts[1], 'manuell', med, { tiefe_cm: h.tiefe_cm });
  return renormalize([...keep, first, second].sort((x, y) => x.id - y.id));
}

/** Entfernt Griffe außerhalb [minRel, maxRel] relativer Größe (zur medianen Griffgröße). */
export function filterBySize(holds: readonly Hold[], minRel: number, maxRel: number): Hold[] {
  return renormalize(holds.filter((h) => h.relative_groesse >= minRel && h.relative_groesse <= maxRel));
}

/** Vereinfacht ein frei gezeichnetes Polygon (Hülle optional). */
export function drawnPolygon(points: readonly Vec2[], hull = false): Vec2[] { return hull ? convexHull(points) : [...points]; }

/** Undo/Redo-Verlauf (unveränderlich). */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(public present: T, private readonly limit = 100) {}
  push(next: T): void { this.past.push(this.present); if (this.past.length > this.limit) this.past.shift(); this.present = next; this.future = []; }
  undo(): boolean { const p = this.past.pop(); if (p === undefined) return false; this.future.push(this.present); this.present = p; return true; }
  redo(): boolean { const f = this.future.pop(); if (f === undefined) return false; this.past.push(this.present); this.present = f; return true; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
}
