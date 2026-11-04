/** Mapping holdId → LED-Index und Farben je Gliedmaße; CSV-Import/-Export; LED-Frame-Berechnung. */
import { LIMBS, type Limb } from '../core/schemas';
import type { Snapshot } from './protocol';

export interface LedMapping {
  /** holdId → LED-Index */
  map: Record<number, number>;
  colors: Record<Limb, string>;
  brightness: number;
  ledCount: number;
}
export const DEFAULT_LIMB_COLORS: Record<Limb, string> = { LH: '#56B4E9', RH: '#E69F00', LF: '#009E73', RF: '#CC79A7' };
export const defaultMapping = (ledCount = 300): LedMapping => ({ map: {}, colors: { ...DEFAULT_LIMB_COLORS }, brightness: 128, ledCount });

export class CsvError extends Error {}

export function mappingToCsv(m: LedMapping): string {
  const rows = ['holdId,led'];
  for (const [h, l] of Object.entries(m.map).sort((a, b) => Number(a[0]) - Number(b[0]))) rows.push(`${h},${l}`);
  return rows.join('\n') + '\n';
}

/** Erwartet Kopf `holdId,led` (auch `;` als Trenner). Doppelte holdId/LED-Indizes und Werte außerhalb des LED-Bereichs werden gemeldet. */
export function mappingFromCsv(text: string, ledCount: number): { map: Record<number, number>; warnungen: string[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new CsvError('Die CSV-Datei ist leer.');
  const sep = (lines[0] as string).includes(';') ? ';' : ',';
  const head = (lines[0] as string).toLowerCase().split(sep).map((s) => s.trim());
  if (head[0] !== 'holdid' || head[1] !== 'led') throw new CsvError('Kopfzeile muss „holdId,led“ lauten.');
  const map: Record<number, number> = {};
  const warnungen: string[] = [];
  const usedLed = new Map<number, number>();
  lines.slice(1).forEach((ln, i) => {
    const [a, b] = ln.split(sep).map((s) => s.trim());
    const h = Number(a), l = Number(b);
    if (!Number.isInteger(h) || h < 0 || !Number.isInteger(l) || l < 0) throw new CsvError(`Zeile ${i + 2}: ungültige Zahlen („${ln}“).`);
    if (l >= ledCount) throw new CsvError(`Zeile ${i + 2}: LED-Index ${l} liegt außerhalb von 0–${ledCount - 1}.`);
    if (h in map) warnungen.push(`Griff ${h} ist doppelt belegt (Zeile ${i + 2}); letzter Wert gilt.`);
    const other = usedLed.get(l);
    if (other !== undefined && other !== h) warnungen.push(`LED ${l} ist Griff ${other} und ${h} zugeordnet.`);
    usedLed.set(l, h); map[h] = l;
  });
  return { map, warnungen };
}

/** Serpentinen-Auto-Mapping (typisch für LED-Streifen): Griffe zeilenweise, jede zweite Zeile rückwärts. `rows` = Griff-IDs je Zeile (links→rechts). */
export function serpentineMapping(rows: readonly (readonly number[])[], start = 0): Record<number, number> {
  const map: Record<number, number> = {};
  let led = start;
  rows.forEach((r, i) => { const row = i % 2 === 0 ? r : [...r].reverse(); for (const id of row) map[id] = led++; });
  return map;
}

export interface LedPixel { led: number; rgb: [number, number, number] }
const hex = (c: string): [number, number, number] => { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Berechnet die LEDs, die für den Zustand leuchten sollen (mehrere Gliedmaßen am selben Griff → Mischfarbe, additiv begrenzt). */
export function ledFrame(snap: Snapshot, m: LedMapping): LedPixel[] {
  const acc = new Map<number, [number, number, number]>();
  for (const l of LIMBS) {
    const s = snap[l];
    if (s.holdId === null) continue;
    const led = m.map[s.holdId];
    if (led === undefined) continue;
    const c = hex(m.colors[l]);
    const cur = acc.get(led) ?? [0, 0, 0];
    acc.set(led, [Math.min(255, cur[0] + c[0]), Math.min(255, cur[1] + c[1]), Math.min(255, cur[2] + c[2])]);
  }
  const k = m.brightness / 255;
  return [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([led, c]) => ({ led, rgb: [Math.round(c[0] * k), Math.round(c[1] * k), Math.round(c[2] * k)] as [number, number, number] }));
}
