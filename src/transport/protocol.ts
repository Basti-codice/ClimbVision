/**
 * ESP32-Protokoll v1 (kompaktes JSON, UTF-8) + optionale Binärvariante für BLE.
 * Siehe docs/PROTOCOL.md.
 */
import { LIMBS, type Limb } from '../core/schemas';

export const PROTOCOL_VERSION = 1;
export const NO_HOLD = 0xffff;

export interface LimbWire { /** holdId */ h: number; /** Konfidenz 0..100 */ c: number; /** 1 = mehrdeutig */ a?: 1 }
export type StateWire = Record<Limb, LimbWire | null>;

export type Msg =
  | { v: 1; t: 'hello'; seq: number; ts: number; client?: string; device?: string; fw?: string; leds?: number; caps?: string[] }
  | { v: 1; t: 'ack'; seq: number }
  | { v: 1; t: 's'; seq: number; ts: number; s: StateWire; act: number[] }
  | { v: 1; t: 'cfg'; seq: number; colors?: Record<Limb, string>; brightness?: number; map?: [number, number][]; part?: [number, number] }
  | { v: 1; t: 'ping'; seq: number; ts: number }
  | { v: 1; t: 'pong'; seq: number; ts: number };

export class ProtocolError extends Error {}

export function encode(m: Msg): string { return JSON.stringify(m); }
export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

const isInt = (x: unknown, min = 0, max = 0xffffffff): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;

export function decode(text: string): Msg {
  let o: unknown;
  try { o = JSON.parse(text); } catch { throw new ProtocolError('Kein gültiges JSON'); }
  if (typeof o !== 'object' || o === null) throw new ProtocolError('Nachricht ist kein Objekt');
  const m = o as Record<string, unknown>;
  if (m['v'] !== PROTOCOL_VERSION) throw new ProtocolError(`Nicht unterstützte Protokollversion: ${String(m['v'])}`);
  if (!isInt(m['seq'])) throw new ProtocolError('seq fehlt oder ungültig');
  switch (m['t']) {
    case 'hello': case 'ack': return m as unknown as Msg;
    case 'ping': case 'pong': if (!isInt(m['ts'])) throw new ProtocolError('ts fehlt'); return m as unknown as Msg;
    case 'cfg': return m as unknown as Msg;
    case 's': {
      const s = m['s'] as Record<string, unknown> | undefined;
      if (!s || !isInt(m['ts']) || !Array.isArray(m['act'])) throw new ProtocolError('Zustandsnachricht unvollständig');
      for (const l of LIMBS) {
        const w = s[l];
        if (w === null) continue;
        const x = w as Partial<LimbWire> | undefined;
        if (!x || !isInt(x.h, 0, NO_HOLD - 1) || !isInt(x.c, 0, 100)) throw new ProtocolError(`Ungültiger Wert für ${l}`);
      }
      return m as unknown as Msg;
    }
    default: throw new ProtocolError(`Unbekannter Nachrichtentyp: ${String(m['t'])}`);
  }
}

export interface LimbSnapshot { holdId: number | null; confidence: number; ambiguous?: boolean }
export type Snapshot = Record<Limb, LimbSnapshot>;

export function stateMsg(seq: number, ts: number, snap: Snapshot): Extract<Msg, { t: 's' }> {
  const s = {} as StateWire;
  const act = new Set<number>();
  for (const l of LIMBS) {
    const x = snap[l];
    if (x.holdId === null) s[l] = null;
    else { s[l] = { h: x.holdId, c: Math.round(Math.max(0, Math.min(1, x.confidence)) * 100), ...(x.ambiguous ? { a: 1 as const } : {}) }; act.add(x.holdId); }
  }
  return { v: 1, t: 's', seq, ts, s, act: [...act].sort((a, b) => a - b) };
}

/** Binärvariante (16 Byte): [0]=0xC1 (Typ/Version), [1]=seq&0xff, 4×(u16 holdId LE, u8 conf), [14]=flags (Bit i: Gliedmaße i mehrdeutig), [15]=XOR-Prüfsumme. */
export const BIN_SIZE = 16;
export function encodeBinary(seq: number, snap: Snapshot): Uint8Array {
  const b = new Uint8Array(BIN_SIZE);
  b[0] = 0xc1; b[1] = seq & 0xff;
  let flags = 0;
  LIMBS.forEach((l, i) => {
    const x = snap[l];
    const id = x.holdId === null ? NO_HOLD : Math.min(NO_HOLD - 1, x.holdId);
    b[2 + i * 3] = id & 0xff; b[3 + i * 3] = id >> 8; b[4 + i * 3] = Math.round(Math.max(0, Math.min(1, x.confidence)) * 100);
    if (x.ambiguous) flags |= 1 << i;
  });
  b[14] = flags;
  let x = 0; for (let i = 0; i < 15; i++) x ^= b[i] as number;
  b[15] = x;
  return b;
}
export function decodeBinary(b: Uint8Array): { seq: number; snap: Snapshot } {
  if (b.length !== BIN_SIZE || b[0] !== 0xc1) throw new ProtocolError('Ungültiges Binärpaket');
  let x = 0; for (let i = 0; i < 15; i++) x ^= b[i] as number;
  if (x !== b[15]) throw new ProtocolError('Prüfsumme falsch');
  const snap = {} as Snapshot;
  LIMBS.forEach((l, i) => {
    const id = (b[2 + i * 3] as number) | ((b[3 + i * 3] as number) << 8);
    snap[l] = { holdId: id === NO_HOLD ? null : id, confidence: (b[4 + i * 3] as number) / 100, ambiguous: ((b[14] as number) >> i & 1) === 1 };
  });
  return { seq: b[1] as number, snap };
}

/** Chunking für kleine MTU (BLE: ATT-MTU − 3 Byte Nutzlast; Standard-MTU 23 → 20 Byte). Je Chunk 2 Byte Kopf: [index, total]. */
export function chunk(data: Uint8Array, payload: number): Uint8Array[] {
  if (payload < 3) throw new ProtocolError('MTU zu klein');
  const body = payload - 2;
  const total = Math.max(1, Math.ceil(data.length / body));
  if (total > 255) throw new ProtocolError('Nachricht zu groß zum Chunken');
  const out: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const part = data.subarray(i * body, (i + 1) * body);
    const c = new Uint8Array(2 + part.length);
    c[0] = i; c[1] = total; c.set(part, 2);
    out.push(c);
  }
  return out;
}
export class Reassembler {
  private parts: Uint8Array[] = [];
  private total = 0;
  /** Gibt die vollständige Nachricht zurück, sobald alle Chunks da sind (sonst null). Ungültige Reihenfolge verwirft den Puffer. */
  push(c: Uint8Array): Uint8Array | null {
    const idx = c[0] as number, total = c[1] as number;
    if (idx === 0) { this.parts = []; this.total = total; }
    if (idx !== this.parts.length || total !== this.total) { this.parts = []; this.total = 0; return null; }
    this.parts.push(c.subarray(2));
    if (this.parts.length < this.total) return null;
    const len = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(len);
    let o = 0; for (const p of this.parts) { out.set(p, o); o += p.length; }
    this.parts = []; this.total = 0;
    return out;
  }
}

/**
 * Sendeverhalten: nur bei Änderung, max. maxHz, Keepalive alle keepaliveMs.
 * `offer` liefert die zu sendende Nachricht oder null. Zeit wird injiziert (testbar).
 */
export class StateSender {
  private last: string | null = null;
  private tLast = -Infinity;
  private seq = 0;
  constructor(private readonly maxHz = 20, private readonly keepaliveMs = 1000) {}
  private key(s: Snapshot): string { return LIMBS.map((l) => `${s[l].holdId ?? '-'}:${Math.round(s[l].confidence * 20)}:${s[l].ambiguous ? 1 : 0}`).join('|'); }
  offer(tMs: number, snap: Snapshot): Extract<Msg, { t: 's' }> | null {
    const k = this.key(snap), minGap = 1000 / this.maxHz;
    const changed = k !== this.last;
    const due = tMs - this.tLast >= this.keepaliveMs;
    if (!(changed || due)) return null;
    if (changed && tMs - this.tLast < minGap) return null; // gedrosselt; wird beim nächsten Aufruf nachgeholt
    this.last = k; this.tLast = tMs;
    return stateMsg(++this.seq, tMs, snap);
  }
  reset(): void { this.last = null; this.tLast = -Infinity; }
}
