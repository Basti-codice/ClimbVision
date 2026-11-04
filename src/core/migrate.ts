/**
 * Migration älterer Dokumentversionen auf SCHEMA_VERSION.
 * Kette v0→v1→…; unbekannte NEUERE Versionen werden abgelehnt (nie still gelesen).
 * v0 = Entwicklungsformat vor dem ersten Release (flache Polygone, englische Feldnamen) – wird beim Import akzeptiert.
 */
import { DOC_SCHEMAS, SCHEMA_VERSION, type DocTyp } from './schemas';
import { bbox, centroid, area } from '../geometry/polygon';
import type { Vec2 } from '../geometry/homography';

export class MigrationError extends Error {}
type Doc = Record<string, unknown>;
type Step = (d: Doc) => Doc;

const flatToPairs = (a: unknown): [number, number][] => {
  const f = a as number[];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < f.length; i += 2) out.push([f[i] as number, f[i + 1] as number]);
  return out;
};

const MIGRATIONS: Record<DocTyp, Record<number, Step>> = {
  Holds: {
    0: (d) => {
      const holds = ((d['holds'] ?? d['griffe']) as Doc[] | undefined) ?? [];
      const polys = holds.map((h) => (Array.isArray(h['polygon']) && typeof (h['polygon'] as unknown[])[0] === 'number' ? flatToPairs(h['polygon']) : (h['polygon'] as [number, number][])));
      const areas = polys.map((p) => area(p as Vec2[])).sort((a, b) => a - b);
      const med = areas[areas.length >> 1] || 1;
      return {
        schemaVersion: 1, typ: 'Holds', wandId: String(d['wallId'] ?? d['wandId'] ?? ''), erstellt: String(d['created'] ?? d['erstellt'] ?? new Date(0).toISOString()),
        griffe: holds.map((h, i) => {
          const p = polys[i] as Vec2[];
          return { id: Number(h['id'] ?? i), polygon: p, schwerpunkt: centroid(p), bbox: bbox(p), flaeche: area(p), relative_groesse: area(p) / med,
            tiefe_cm: Number(h['depth_cm'] ?? h['tiefe_cm'] ?? 0), quelle: h['source'] === 'manual' || h['quelle'] === 'manuell' ? 'manuell' : 'auto' };
        }),
      };
    },
  },
  WallProfile: {},
  Route: {},
  Session: {},
};

export function migrate(raw: unknown): { typ: DocTyp; doc: unknown; vonVersion: number } {
  if (typeof raw !== 'object' || raw === null) throw new MigrationError('Kein gültiges Dokument');
  let d = raw as Doc;
  const typ = (d['typ'] ?? (d['holds'] || d['griffe'] ? 'Holds' : undefined)) as DocTyp | undefined;
  if (!typ || !(typ in DOC_SCHEMAS)) throw new MigrationError('Unbekannter Dokumenttyp');
  const v0 = typeof d['schemaVersion'] === 'number' ? (d['schemaVersion'] as number) : 0;
  if (v0 > SCHEMA_VERSION) throw new MigrationError(`Dokument stammt aus einer neueren Version (${v0}); bitte ClimbVision aktualisieren.`);
  let v = v0;
  while (v < SCHEMA_VERSION) {
    const step = MIGRATIONS[typ][v];
    if (!step) throw new MigrationError(`Keine Migration von Version ${v} für ${typ}`);
    d = step(d);
    v++;
  }
  const parsed = DOC_SCHEMAS[typ].safeParse(d);
  if (!parsed.success) throw new MigrationError('Dokument ungültig: ' + parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return { typ, doc: parsed.data, vonVersion: v0 };
}
