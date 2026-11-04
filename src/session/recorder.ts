/** Session-Aufnahme: spaltenorientierte Binär-Chunks (Keypoints in Wandkoordinaten, Kontaktzustand je Gliedmaße) + Ereignisse. */
import { LIMBS, type ContactEventDoc, type Limb } from '../core/schemas';
import type { ContactState } from '../contact/matcher';
import type { SkeletonPoint } from '../pipeline/live';

export const N_KP = 33;
export const FRAMES_PER_CHUNK = 150;
const MAGIC = 0x31435643; // "CVC1"

export interface RecFrame { t: number; kp: Float32Array /* N_KP*3 (u,v,c); NaN = fehlt */; hold: Int16Array /* 4, -1 = frei */; conf: Uint8Array /* 4, 0..100 */ }
export interface Chunk { t0: number; n: number; t: Float32Array; kp: Float32Array; hold: Int16Array; conf: Uint8Array }

export function frameFrom(t: number, skeleton: (SkeletonPoint | null)[] | null, cs: ContactState): RecFrame {
  const kp = new Float32Array(N_KP * 3).fill(NaN);
  if (skeleton) skeleton.forEach((p, i) => { if (p && i < N_KP) { kp[i * 3] = p.u; kp[i * 3 + 1] = p.v; kp[i * 3 + 2] = p.c; } });
  const hold = new Int16Array(4), conf = new Uint8Array(4);
  LIMBS.forEach((l, i) => { const s = cs.limbs[l]; const active = s.holdId !== null && (s.state === 'CONTACT' || s.state === 'HOLDING' || s.state === 'OCCLUDED_HOLD'); hold[i] = active ? (s.holdId as number) : -1; conf[i] = active ? Math.round(Math.max(0, Math.min(1, s.confidence)) * 100) : 0; });
  return { t, kp, hold, conf };
}

export function buildChunk(frames: readonly RecFrame[]): Chunk {
  const n = frames.length, t0 = n ? (frames[0] as RecFrame).t : 0;
  const c: Chunk = { t0, n, t: new Float32Array(n), kp: new Float32Array(n * N_KP * 3), hold: new Int16Array(n * 4), conf: new Uint8Array(n * 4) };
  frames.forEach((f, i) => { c.t[i] = f.t - t0; c.kp.set(f.kp, i * N_KP * 3); c.hold.set(f.hold, i * 4); c.conf.set(f.conf, i * 4); });
  return c;
}

export function encodeChunk(c: Chunk): Uint8Array {
  const head = 16;
  const size = head + c.t.byteLength + c.kp.byteLength + c.hold.byteLength + c.conf.byteLength;
  const buf = new ArrayBuffer(size); const dv = new DataView(buf);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, c.n, true); dv.setFloat64(8, c.t0, true);
  let o = head;
  new Float32Array(buf, o, c.n).set(c.t); o += c.t.byteLength;
  new Float32Array(buf, o, c.kp.length).set(c.kp); o += c.kp.byteLength;
  new Int16Array(buf, o, c.hold.length).set(c.hold); o += c.hold.byteLength;
  new Uint8Array(buf, o, c.conf.length).set(c.conf);
  return new Uint8Array(buf);
}
export function decodeChunk(bytes: Uint8Array): Chunk {
  const b = bytes.byteOffset % 4 === 0 ? bytes : Uint8Array.from(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('Kein gültiger Session-Chunk');
  const n = dv.getUint32(4, true), t0 = dv.getFloat64(8, true);
  let o = b.byteOffset + 16;
  const t = new Float32Array(b.buffer.slice(o, o + n * 4)); o += n * 4;
  const kp = new Float32Array(b.buffer.slice(o, o + n * N_KP * 12)); o += n * N_KP * 12;
  const hold = new Int16Array(b.buffer.slice(o, o + n * 8)); o += n * 8;
  const conf = new Uint8Array(b.buffer.slice(o, o + n * 4));
  return { t0, n, t, kp, hold, conf };
}

export class SessionRecorder {
  private frames: RecFrame[] = [];
  private chunks: Chunk[] = [];
  readonly events: ContactEventDoc[] = [];
  private t0: number | null = null;
  constructor(private readonly onChunk?: (c: Chunk, index: number) => void) {}
  get dauerMs(): number { return this.lastT; }
  private lastT = 0;
  get frameCount(): number { return this.chunks.reduce((n, c) => n + c.n, 0) + this.frames.length; }
  addFrame(t: number, skeleton: (SkeletonPoint | null)[] | null, cs: ContactState): void {
    if (this.t0 === null) this.t0 = t;
    const rel = t - this.t0; this.lastT = rel;
    this.frames.push(frameFrom(rel, skeleton, cs));
    if (this.frames.length >= FRAMES_PER_CHUNK) this.flush();
  }
  addEvents(evs: readonly { t: number; limb: Limb; typ: 'start' | 'ende' | 'wechsel'; holdId: number | null; vonHoldId: number | null; score: number; evidenz: ContactEventDoc['evidenz'] }[]): void {
    for (const e of evs) this.events.push({ t: e.t - (this.t0 ?? 0), limb: e.limb, typ: e.typ, holdId: e.holdId, vonHoldId: e.vonHoldId, score: e.score, evidenz: e.evidenz });
  }
  flush(): void {
    if (!this.frames.length) return;
    const c = buildChunk(this.frames); this.frames = [];
    this.chunks.push(c); this.onChunk?.(c, this.chunks.length - 1);
  }
  finish(): Chunk[] { this.flush(); return this.chunks; }
}

/** Replay: zeitgesteuerter Zugriff auf Chunks (Scrubbing, Zeitlupe, Einzelbild). */
export class ReplayEngine {
  private times: Float64Array;
  private refs: { c: Chunk; i: number }[] = [];
  playing = false; speed = 1; position = 0;
  constructor(chunks: readonly Chunk[]) {
    const ts: number[] = [];
    for (const c of chunks) for (let i = 0; i < c.n; i++) { ts.push(c.t0 + (c.t[i] as number)); this.refs.push({ c, i }); }
    this.times = Float64Array.from(ts);
  }
  get length(): number { return this.times.length; }
  get durationMs(): number { return this.times.length ? (this.times[this.times.length - 1] as number) : 0; }
  /** Index des letzten Frames mit t ≤ tMs (binäre Suche). */
  indexAt(tMs: number): number {
    let lo = 0, hi = this.times.length - 1, r = 0;
    while (lo <= hi) { const m = (lo + hi) >> 1; if ((this.times[m] as number) <= tMs) { r = m; lo = m + 1; } else hi = m - 1; }
    return r;
  }
  frame(i: number): RecFrame | null {
    const r = this.refs[i]; if (!r) return null;
    const { c, i: k } = r;
    return { t: c.t0 + (c.t[k] as number), kp: c.kp.subarray(k * N_KP * 3, (k + 1) * N_KP * 3), hold: c.hold.subarray(k * 4, k * 4 + 4), conf: c.conf.subarray(k * 4, k * 4 + 4) };
  }
  frameAt(tMs: number): RecFrame | null { return this.frame(this.indexAt(tMs)); }
  seek(tMs: number): void { this.position = Math.max(0, Math.min(this.durationMs, tMs)); }
  /** Realzeit-Fortschritt; Rückgabe: aktueller Frame. */
  tick(dtRealMs: number): RecFrame | null {
    if (this.playing) { this.position += dtRealMs * this.speed; if (this.position >= this.durationMs) { this.position = this.durationMs; this.playing = false; } }
    return this.frameAt(this.position);
  }
  stepFrame(delta: number): RecFrame | null {
    const i = Math.max(0, Math.min(this.length - 1, this.indexAt(this.position) + delta));
    this.position = this.times[i] as number; return this.frame(i);
  }
}
