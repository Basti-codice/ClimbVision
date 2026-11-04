/** Transporte zum ESP32: einheitliches Interface + WebSocket (Standard), Web Serial, Web Bluetooth (NUS). Der ESP32 selbst ist nicht Teil der Software – hier liegt nur die Schnittstelle. */
import { PROTOCOL_VERSION, chunk, decode, encode, encodeBinary, type Msg, type Snapshot, Reassembler, ProtocolError } from './protocol';

export type TransportState = 'getrennt' | 'verbinde' | 'verbunden' | 'wiederverbinde' | 'fehler';
export interface TransportStatus { state: TransportState; latencyMs: number | null; meldung?: string; reconnects: number; lastRx: number | null }
export interface Esp32Transport {
  readonly kind: 'websocket' | 'serial' | 'ble';
  connect(): Promise<void>;
  send(msg: Msg | Snapshot, seq?: number): void;
  onStatus(cb: (s: TransportStatus) => void): () => void;
  onMessage(cb: (m: Msg) => void): () => void;
  disconnect(): void;
}

class Base {
  protected status: TransportStatus = { state: 'getrennt', latencyMs: null, reconnects: 0, lastRx: null };
  private sCbs = new Set<(s: TransportStatus) => void>();
  private mCbs = new Set<(m: Msg) => void>();
  onStatus(cb: (s: TransportStatus) => void): () => void { this.sCbs.add(cb); cb(this.status); return () => this.sCbs.delete(cb); }
  onMessage(cb: (m: Msg) => void): () => void { this.mCbs.add(cb); return () => this.mCbs.delete(cb); }
  protected set(p: Partial<TransportStatus>): void { this.status = { ...this.status, ...p }; for (const c of this.sCbs) c(this.status); }
  protected emitMsg(m: Msg): void { for (const c of this.mCbs) c(m); }
}

export interface Clock { now(): number; setTimeout(f: () => void, ms: number): unknown; clearTimeout(h: unknown): void; setInterval(f: () => void, ms: number): unknown; clearInterval(h: unknown): void }
export const realClock: Clock = {
  now: () => performance.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h as number),
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h as number),
};

export interface WsLike { readyState: number; send(d: string): void; close(): void; onopen: (() => void) | null; onclose: (() => void) | null; onerror: (() => void) | null; onmessage: ((e: { data: unknown }) => void) | null }
export type WsFactory = (url: string) => WsLike;

/** WebSocket mit Auto-Reconnect (exponentielles Backoff), Heartbeat (ping/pong) und Latenzmessung. */
export class WebSocketTransport extends Base implements Esp32Transport {
  readonly kind = 'websocket' as const;
  private ws: WsLike | null = null;
  private want = false;
  private seq = 0;
  private attempt = 0;
  private hb: unknown = null;
  private retry: unknown = null;
  private pings = new Map<number, number>();
  constructor(private readonly url: string, private readonly factory: WsFactory = (u) => new WebSocket(u) as unknown as WsLike, private readonly clock: Clock = realClock,
    private readonly opt = { heartbeatMs: 1000, timeoutMs: 3500, backoffMs: [500, 1000, 2000, 4000, 8000] }) { super(); }

  connect(): Promise<void> {
    this.want = true;
    return new Promise((resolve, reject) => {
      const open = (first: boolean): void => {
        this.set({ state: first ? 'verbinde' : 'wiederverbinde' });
        let ws: WsLike;
        try { ws = this.factory(this.url); } catch (e) { this.set({ state: 'fehler', meldung: `Verbindung nicht möglich: ${String(e)}` }); if (first) reject(e); return; }
        this.ws = ws;
        ws.onopen = () => {
          this.attempt = 0; this.set({ state: 'verbunden', meldung: '', lastRx: this.clock.now() });
          this.sendRaw({ v: PROTOCOL_VERSION, t: 'hello', seq: ++this.seq, ts: Math.round(this.clock.now()), client: 'climbvision', caps: ['json'] });
          this.startHeartbeat();
          if (first) { first = false; resolve(); }
        };
        ws.onmessage = (e) => {
          this.set({ lastRx: this.clock.now() });
          try {
            const m = decode(String(e.data));
            if (m.t === 'pong') { const t0 = this.pings.get(m.seq); if (t0 !== undefined) { this.pings.delete(m.seq); this.set({ latencyMs: Math.round(this.clock.now() - t0) }); } }
            else if (m.t === 'ping') this.sendRaw({ v: 1, t: 'pong', seq: m.seq, ts: m.ts });
            this.emitMsg(m);
          } catch (err) { if (!(err instanceof ProtocolError)) throw err; this.set({ meldung: `Ungültige Nachricht vom Gerät: ${err.message}` }); }
        };
        ws.onerror = () => { /* onclose folgt */ };
        ws.onclose = () => {
          this.stopHeartbeat();
          if (!this.want) { this.set({ state: 'getrennt' }); return; }
          if (first) { this.set({ state: 'fehler', meldung: 'ESP32 nicht erreichbar. IP-Adresse und WLAN prüfen.' }); first = false; reject(new Error('Verbindung fehlgeschlagen')); }
          this.scheduleReconnect(open);
        };
      };
      open(true);
    });
  }
  private scheduleReconnect(open: (first: boolean) => void): void {
    if (!this.want) return;
    const d = this.opt.backoffMs[Math.min(this.attempt++, this.opt.backoffMs.length - 1)] as number;
    this.set({ state: 'wiederverbinde', reconnects: this.status.reconnects + 1 });
    this.retry = this.clock.setTimeout(() => open(false), d);
  }
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.hb = this.clock.setInterval(() => {
      const now = this.clock.now();
      if (this.status.lastRx !== null && now - this.status.lastRx > this.opt.timeoutMs) { this.ws?.close(); return; } // Zeitüberschreitung → Reconnect über onclose
      const seq = ++this.seq; this.pings.set(seq, now);
      if (this.pings.size > 10) this.pings.delete(this.pings.keys().next().value as number);
      this.sendRaw({ v: 1, t: 'ping', seq, ts: Math.round(now) });
    }, this.opt.heartbeatMs);
  }
  private stopHeartbeat(): void { if (this.hb !== null) this.clock.clearInterval(this.hb); this.hb = null; }
  private sendRaw(m: Msg): void { if (this.ws && this.ws.readyState === 1) this.ws.send(encode(m)); }
  send(msg: Msg | Snapshot): void { if ('t' in msg) this.sendRaw(msg as Msg); }
  disconnect(): void {
    this.want = false; this.stopHeartbeat();
    if (this.retry !== null) this.clock.clearTimeout(this.retry);
    this.ws?.close(); this.set({ state: 'getrennt' });
  }
}

/** Web Serial (USB): zeilenweises JSON (\n-terminiert). Nur Chromium, Nutzergeste nötig. */
export class WebSerialTransport extends Base implements Esp32Transport {
  readonly kind = 'serial' as const;
  private port: { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; writable: WritableStream<Uint8Array> | null; readable: ReadableStream<Uint8Array> | null } | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reading = false;
  constructor(private readonly baud = 115200) { super(); }
  async connect(): Promise<void> {
    const nav = navigator as unknown as { serial?: { requestPort(): Promise<unknown> } };
    if (!nav.serial) throw new Error('Web Serial wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.');
    this.set({ state: 'verbinde' });
    try {
      this.port = (await nav.serial.requestPort()) as NonNullable<typeof this.port>;
      await this.port.open({ baudRate: this.baud });
      this.writer = this.port.writable?.getWriter() ?? null;
      this.set({ state: 'verbunden', meldung: '' });
      void this.readLoop();
      this.send({ v: 1, t: 'hello', seq: 1, ts: Math.round(performance.now()), client: 'climbvision' });
    } catch (e) { this.set({ state: 'fehler', meldung: `USB-Verbindung fehlgeschlagen: ${String((e as Error).message ?? e)}` }); throw e; }
  }
  private async readLoop(): Promise<void> {
    if (!this.port?.readable || this.reading) return;
    this.reading = true;
    const reader = this.port.readable.getReader(); const dec = new TextDecoder(); let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('{')) continue; // Debug-Ausgaben der Firmware ignorieren
          try { const m = decode(line); this.set({ lastRx: performance.now() }); this.emitMsg(m); } catch { /* ignorieren */ }
        }
      }
    } finally { reader.releaseLock(); this.reading = false; }
  }
  send(msg: Msg | Snapshot): void { if ('t' in msg && this.writer) void this.writer.write(new TextEncoder().encode(encode(msg as Msg) + '\n')); }
  disconnect(): void { void (async () => { try { this.writer?.releaseLock(); await this.port?.close(); } catch { /* egal */ } this.set({ state: 'getrennt' }); })(); }
}

export const NUS = { service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' };
type Chr = { writeValueWithoutResponse(v: BufferSource): Promise<void>; startNotifications(): Promise<unknown>; addEventListener(t: string, f: (e: unknown) => void): void };

/** Web Bluetooth (Nordic UART Service). Zustände als 16-Byte-Binärpaket; große Nachrichten werden gechunkt (Standard-MTU 23 → 20 Byte). */
export class WebBluetoothTransport extends Base implements Esp32Transport {
  readonly kind = 'ble' as const;
  private rx: Chr | null = null;
  private gatt: { connected: boolean; disconnect(): void } | null = null;
  private seq = 0;
  private re = new Reassembler();
  constructor(private readonly payload = 20) { super(); }
  async connect(): Promise<void> {
    const nav = navigator as unknown as { bluetooth?: { requestDevice(o: unknown): Promise<{ gatt: { connect(): Promise<{ getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<Chr> }>; connected: boolean; disconnect(): void }> }; addEventListener(t: string, f: () => void): void }> } };
    if (!nav.bluetooth) throw new Error('Web Bluetooth wird von diesem Browser nicht unterstützt. Bitte Chrome oder Edge verwenden.');
    this.set({ state: 'verbinde' });
    try {
      const dev = await nav.bluetooth.requestDevice({ filters: [{ services: [NUS.service] }] });
      dev.addEventListener('gattserverdisconnected', () => this.set({ state: 'getrennt', meldung: 'Bluetooth-Verbindung getrennt.' }));
      const server = await dev.gatt.connect();
      this.gatt = server;
      const svc = await server.getPrimaryService(NUS.service);
      this.rx = await svc.getCharacteristic(NUS.rx);
      const tx = await svc.getCharacteristic(NUS.tx);
      await tx.startNotifications();
      tx.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e as { target: { value: DataView } }).target.value;
        const full = this.re.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        if (full) { try { this.emitMsg(decode(new TextDecoder().decode(full))); this.set({ lastRx: performance.now() }); } catch { /* ignorieren */ } }
      });
      this.set({ state: 'verbunden', meldung: '' });
    } catch (e) { this.set({ state: 'fehler', meldung: `Bluetooth-Verbindung fehlgeschlagen: ${String((e as Error).message ?? e)}` }); throw e; }
  }
  send(msg: Msg | Snapshot): void {
    if (!this.rx) return;
    if ('t' in msg) { for (const c of chunk(new TextEncoder().encode(encode(msg as Msg)), this.payload)) void this.rx.writeValueWithoutResponse(c as unknown as BufferSource); }
    else void this.rx.writeValueWithoutResponse(encodeBinary(++this.seq, msg) as unknown as BufferSource);
  }
  disconnect(): void { this.gatt?.disconnect(); this.set({ state: 'getrennt' }); }
}
