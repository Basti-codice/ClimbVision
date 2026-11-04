import { describe, expect, it } from 'vitest';
import { BIN_SIZE, ProtocolError, Reassembler, StateSender, byteLength, chunk, decode, decodeBinary, encode, encodeBinary, stateMsg, type Msg, type Snapshot } from '../src/transport/protocol';
import { WebSocketTransport, type Clock, type TransportStatus, type WsLike } from '../src/transport/transports';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ LH: { holdId: 12, confidence: 0.91 }, RH: { holdId: 22, confidence: 0.64, ambiguous: true }, LF: { holdId: null, confidence: 0 }, RF: { holdId: 5, confidence: 0.4 }, ...over });

class FakeClock implements Clock {
  t = 0; private id = 0; private timers = new Map<number, { at: number; f: () => void; every?: number }>();
  now(): number { return this.t; }
  setTimeout(f: () => void, ms: number): number { const i = ++this.id; this.timers.set(i, { at: this.t + ms, f }); return i; }
  clearTimeout(h: unknown): void { this.timers.delete(h as number); }
  setInterval(f: () => void, ms: number): number { const i = ++this.id; this.timers.set(i, { at: this.t + ms, f, every: ms }); return i; }
  clearInterval(h: unknown): void { this.timers.delete(h as number); }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; f: () => void; every?: number }] | null = null;
      for (const e of this.timers.entries()) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.t = next[1].at;
      if (next[1].every) next[1].at += next[1].every; else this.timers.delete(next[0]);
      next[1].f();
    }
    this.t = end;
  }
}

describe('Protokoll', () => {
  it('JSON-Roundtrip und kompakte Größe (Zustand mit 3 aktiven Gliedmaßen ≈ 135 Byte)', () => {
    const m = stateMsg(7, 123456, snap());
    const text = encode(m);
    expect(decode(text)).toEqual(m);
    expect(byteLength(text)).toBeLessThanOrEqual(150);
    expect(byteLength(text)).toBeGreaterThan(100); // passt nie in ein 20-Byte-BLE-Paket
    expect(m.act).toEqual([5, 12, 22]);
    expect(m.s.LF).toBeNull();
    expect(m.s.RH).toEqual({ h: 22, c: 64, a: 1 });
  });
  it('lehnt ungültige Nachrichten ab (Version, Typ, Werte, kein JSON)', () => {
    expect(() => decode('nix')).toThrow(ProtocolError);
    expect(() => decode(JSON.stringify({ v: 2, t: 'ack', seq: 1 }))).toThrow(/version/i);
    expect(() => decode(JSON.stringify({ v: 1, t: 'foo', seq: 1 }))).toThrow(/Unbekannt/);
    expect(() => decode(JSON.stringify({ v: 1, t: 's', seq: 1, ts: 1, act: [], s: { LH: { h: 1, c: 200 }, RH: null, LF: null, RF: null } }))).toThrow(/LH/);
    expect(() => decode(JSON.stringify({ v: 1, t: 'ack' }))).toThrow(/seq/);
    expect(decode(JSON.stringify({ v: 1, t: 'ack', seq: 3 })).t).toBe('ack');
  });
  it('Binärvariante: 16 Byte, Roundtrip, Prüfsumme erkennt Bitfehler', () => {
    const b = encodeBinary(300, snap());
    expect(b.length).toBe(BIN_SIZE);
    const d = decodeBinary(b);
    expect(d.seq).toBe(300 & 0xff);
    expect(d.snap.LH.holdId).toBe(12);
    expect(d.snap.LF.holdId).toBeNull();
    expect(d.snap.RH.ambiguous).toBe(true);
    expect(d.snap.LH.confidence).toBeCloseTo(0.91, 2);
    const bad = Uint8Array.from(b); bad[3] = (bad[3] as number) ^ 1;
    expect(() => decodeBinary(bad)).toThrow(/Prüfsumme/);
    expect(() => decodeBinary(new Uint8Array(5))).toThrow(ProtocolError);
  });
  it('Chunking: BLE-Standard-MTU (20 Byte Nutzlast) – Nachricht wird zerlegt und exakt rekonstruiert', () => {
    const data = new TextEncoder().encode(encode(stateMsg(1, 5, snap())));
    for (const payload of [20, 23, 100, 244]) {
      const parts = chunk(data, payload);
      for (const p of parts) expect(p.length).toBeLessThanOrEqual(payload);
      const re = new Reassembler(); let out: Uint8Array | null = null;
      for (const p of parts) out = re.push(p);
      expect(out).not.toBeNull();
      expect(new TextDecoder().decode(out!)).toBe(new TextDecoder().decode(data));
    }
    expect(chunk(data, 20).length).toBeGreaterThan(5); // JSON passt NICHT in ein 20-Byte-Paket → Binär für BLE
    expect(() => chunk(data, 2)).toThrow();
  });
  it('Reassembler verwirft bei verlorenem Chunk', () => {
    const data = new Uint8Array(100).map((_, i) => i);
    const parts = chunk(data, 20);
    const re = new Reassembler();
    re.push(parts[0]!); re.push(parts[2]!); // Chunk 1 fehlt
    let out: Uint8Array | null = null; for (const p of parts.slice(3)) out = re.push(p);
    expect(out).toBeNull();
    for (const p of parts) out = re.push(p); // neuer Versuch klappt
    expect(out).not.toBeNull();
  });
  it('Config-Nachricht: 400 Griffe passen (≤ 255 Chunks bei 20-Byte-MTU), 1000 Griffe nicht → Hinweis, größere MTU oder WLAN nutzen', () => {
    const mk = (n: number): Uint8Array => new TextEncoder().encode(encode({ v: 1, t: 'cfg', seq: 1, map: Array.from({ length: n }, (_, i) => [i + 1, i] as [number, number]) } as Msg));
    expect(chunk(mk(400), 20).length).toBeGreaterThan(100);
    expect(chunk(mk(400), 20).length).toBeLessThanOrEqual(255);
    expect(() => chunk(mk(1000), 20)).toThrow(/zu groß/);
    expect(chunk(mk(1000), 244).length).toBeLessThan(255);
  });
});

describe('Sende-Drosselung', () => {
  it('sendet nur bei Änderung, max. 20 Hz, Keepalive 1 Hz', () => {
    const s = new StateSender(20, 1000);
    const out: number[] = [];
    let t = 0;
    const a = snap(), b = snap({ LF: { holdId: 3, confidence: 0.8 } });
    for (; t < 100; t += 5) if (s.offer(t, t < 50 ? a : b)) out.push(t);
    expect(out.length).toBeLessThanOrEqual(3); // erste Sendung + Änderung (frühestens nach 50 ms)
    expect(out[0]).toBe(0);
    const n0 = out.length;
    for (; t < 900; t += 33) expect(s.offer(t, b)).toBeNull(); // unverändert → nichts
    expect(s.offer(1100, b)).not.toBeNull(); // Keepalive (≥ 1000 ms nach der letzten Sendung)
    expect(out.length).toBe(n0);
    // schnelle Änderungen werden auf 20 Hz begrenzt
    const s2 = new StateSender(20, 1000); let sent = 0;
    for (let i = 0; i < 1000; i++) if (s2.offer(i, snap({ LH: { holdId: i % 7, confidence: 0.9 } }))) sent++;
    expect(sent).toBeLessThanOrEqual(21);
    expect(sent).toBeGreaterThan(15);
  });
  it('seq steigt monoton; Konfidenz-Rauschen unter 5 % löst nichts aus', () => {
    const s = new StateSender(20, 1000);
    const m1 = s.offer(0, snap())!, m2 = s.offer(100, snap({ LH: { holdId: 12, confidence: 0.92 } }));
    expect(m2).toBeNull();
    const m3 = s.offer(1000, snap())!;
    expect(m3.seq).toBe(m1.seq + 1);
  });
});

class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  readyState = 0; sent: string[] = [];
  onopen: (() => void) | null = null; onclose: (() => void) | null = null; onerror: (() => void) | null = null; onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(public url: string) { FakeWs.all.push(this); }
  send(d: string): void { this.sent.push(d); }
  close(): void { this.readyState = 3; this.onclose?.(); }
  open(): void { this.readyState = 1; this.onopen?.(); }
  rx(m: Msg): void { this.onmessage?.({ data: encode(m) }); }
}

describe('WebSocketTransport', () => {
  const setup = (): { clock: FakeClock; tr: WebSocketTransport; sts: TransportStatus[] } => {
    FakeWs.all = []; const clock = new FakeClock();
    const tr = new WebSocketTransport('ws://192.168.1.50:81', (u) => new FakeWs(u), clock);
    const sts: TransportStatus[] = []; tr.onStatus((s) => sts.push(s));
    return { clock, tr, sts };
  };
  it('verbindet, sendet hello, misst Latenz über ping/pong', async () => {
    const { clock, tr } = setup();
    const p = tr.connect(); const ws = FakeWs.all[0]!; ws.open(); await p;
    expect(decode(ws.sent[0]!).t).toBe('hello');
    clock.advance(1000);
    const ping = decode(ws.sent.at(-1)!); expect(ping.t).toBe('ping');
    clock.advance(42); ws.rx({ v: 1, t: 'pong', seq: ping.seq, ts: 0 });
    let st!: TransportStatus; tr.onStatus((s) => (st = s));
    expect(st.state).toBe('verbunden');
    expect(st.latencyMs).toBe(42);
  });
  it('Verbindung schlägt fehl → verständliche Meldung (deutsch) und Ablehnung', async () => {
    const { tr } = setup();
    const p = tr.connect(); FakeWs.all[0]!.close();
    await expect(p).rejects.toThrow();
    let st!: TransportStatus; tr.onStatus((s) => (st = s));
    expect(st.meldung).toMatch(/nicht erreichbar/);
    tr.disconnect();
  });
  it('Auto-Reconnect mit Backoff nach Abbruch; Heartbeat-Timeout erzwingt Reconnect', async () => {
    const { clock, tr } = setup();
    const p = tr.connect(); FakeWs.all[0]!.open(); await p;
    FakeWs.all[0]!.close(); // Abbruch
    let st!: TransportStatus; tr.onStatus((s) => (st = s));
    expect(st.state).toBe('wiederverbinde');
    clock.advance(499); expect(FakeWs.all.length).toBe(1);
    clock.advance(2); expect(FakeWs.all.length).toBe(2);
    FakeWs.all[1]!.open();
    expect(st.state).toBe('verbunden');
    // keine Antworten vom Gerät → Timeout (>3,5 s) → close → Reconnect
    clock.advance(5000);
    expect(FakeWs.all.length).toBeGreaterThanOrEqual(3);
    expect(st.reconnects).toBeGreaterThanOrEqual(2);
    tr.disconnect();
    const n = FakeWs.all.length; clock.advance(20000);
    expect(FakeWs.all.length).toBe(n); // nach disconnect kein Reconnect mehr
  });
  it('ungültige Gerätenachricht wird gemeldet, stürzt nicht ab', async () => {
    const { tr } = setup();
    const p = tr.connect(); const ws = FakeWs.all[0]!; ws.open(); await p;
    ws.onmessage?.({ data: '{kaputt' });
    let st!: TransportStatus; tr.onStatus((s) => (st = s));
    expect(st.meldung).toMatch(/Ungültige/);
  });
});
