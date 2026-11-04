/** ESP32-Dienst: Transportwahl, Mapping-Persistenz, Zustandsversand (nur bei Änderung, ≤ 20 Hz, Keepalive 1 Hz), Testmuster. */
import type { ContactState } from '../contact/matcher';
import { LIMBS } from '../core/schemas';
import { StateSender, type Msg, type Snapshot } from '../transport/protocol';
import { VirtualEsp32, WebBluetoothTransport, WebSerialTransport, WebSocketTransport, type Esp32Transport, type TransportStatus } from '../transport/transports';
import type { LedMapping } from '../transport/mapping';

export type TransportKind = 'websocket' | 'ble' | 'serial' | 'virtual';
export function snapshotOf(cs: ContactState): Snapshot {
  const s = {} as Snapshot;
  for (const l of LIMBS) { const x = cs.limbs[l]; const active = x.holdId !== null && (x.state === 'CONTACT' || x.state === 'HOLDING' || x.state === 'OCCLUDED_HOLD'); s[l] = { holdId: active ? x.holdId : null, confidence: active ? x.confidence : 0, ambiguous: x.ambiguous }; }
  return s;
}

export class Esp32Service {
  transport: Esp32Transport | null = null;
  virtual: VirtualEsp32 | null = null;
  status: TransportStatus = { state: 'getrennt', latencyMs: null, reconnects: 0, lastRx: null };
  private sender = new StateSender(20, 1000);
  private unsub: (() => void)[] = [];
  sentCount = 0;
  onStatus: (s: TransportStatus) => void = () => {};
  onMessage: (m: Msg) => void = () => {};

  constructor(private mapping: LedMapping) {}
  setMapping(m: LedMapping): void { this.mapping = m; if (this.virtual) this.virtual.mapping = m; }

  async connect(kind: TransportKind, opt: { url?: string } = {}): Promise<void> {
    this.disconnect();
    this.virtual = null;
    const tr: Esp32Transport = kind === 'websocket' ? new WebSocketTransport(opt.url ?? 'ws://192.168.4.1:81')
      : kind === 'ble' ? new WebBluetoothTransport()
      : kind === 'serial' ? new WebSerialTransport()
      : (this.virtual = new VirtualEsp32(this.mapping));
    this.transport = tr;
    this.unsub.push(tr.onStatus((s) => { this.status = s; this.onStatus(s); }), tr.onMessage((m) => this.onMessage(m)));
    await tr.connect();
    this.sender.reset();
    this.sendConfig();
  }
  disconnect(): void { for (const u of this.unsub) u(); this.unsub = []; this.transport?.disconnect(); this.transport = null; this.status = { ...this.status, state: 'getrennt' }; }

  /** Konfiguration (Farben, Helligkeit, Mapping) übertragen. Bei BLE nur Farben/Helligkeit (Mapping wäre zu groß – siehe PROTOCOL.md). */
  sendConfig(): void {
    const tr = this.transport; if (!tr) return;
    const full: Msg = { v: 1, t: 'cfg', seq: 1000, colors: this.mapping.colors, brightness: this.mapping.brightness, map: Object.entries(this.mapping.map).map(([h, l]) => [Number(h), l] as [number, number]) };
    tr.send(tr.kind === 'ble' ? { ...full, map: [] } as Msg : full);
  }

  /** Aufruf nach jedem Pipeline-Frame. Sendet nur, wenn nötig. */
  offer(cs: ContactState, tMs: number): boolean {
    if (!this.transport || this.status.state !== 'verbunden') return false;
    const m = this.sender.offer(tMs, snapshotOf(cs)); if (!m) return false;
    this.transport.send(this.transport.kind === 'ble' ? snapshotOf(cs) : m, m.seq); this.sentCount++; return true;
  }

  /** Testmuster: jede Gliedmaße läuft nacheinander über die gemappten Griffe. Rückgabe: Abbruchfunktion. */
  testPattern(stepMs = 400): () => void {
    const ids = Object.keys(this.mapping.map).map(Number).sort((a, b) => a - b);
    let i = 0; let seq = 5000;
    const h = window.setInterval(() => {
      if (!this.transport || !ids.length) return;
      const snap = {} as Snapshot;
      LIMBS.forEach((l, k) => { const id = ids[(i + k * Math.max(1, Math.floor(ids.length / 4))) % ids.length] as number; snap[l] = { holdId: id, confidence: 1 }; });
      this.transport.send(this.transport.kind === 'ble' ? snap : { v: 1, t: 's', seq: ++seq, ts: Math.round(performance.now()), s: Object.fromEntries(LIMBS.map((l) => [l, { h: (snap[l].holdId as number), c: 100 }])) as never, act: [] });
      i++;
    }, stepMs);
    return () => clearInterval(h);
  }
}
