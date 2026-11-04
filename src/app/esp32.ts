/** ESP32-Schnittstelle: Transport wählen, Zustand senden (nur bei Änderung, ≤ 20 Hz, Keepalive 1 Hz). Der ESP32 selbst ist nicht Teil der Software. */
import type { ContactState } from '../contact/matcher';
import { LIMBS } from '../core/schemas';
import { StateSender, type Msg, type Snapshot } from '../transport/protocol';
import { WebBluetoothTransport, WebSerialTransport, WebSocketTransport, type Esp32Transport, type TransportStatus } from '../transport/transports';

export type TransportKind = 'websocket' | 'ble' | 'serial';
export function snapshotOf(cs: ContactState): Snapshot {
  const s = {} as Snapshot;
  for (const l of LIMBS) { const x = cs.limbs[l]; const active = x.holdId !== null && (x.state === 'CONTACT' || x.state === 'HOLDING' || x.state === 'OCCLUDED_HOLD'); s[l] = { holdId: active ? x.holdId : null, confidence: active ? x.confidence : 0, ambiguous: x.ambiguous }; }
  return s;
}

export class Esp32Service {
  transport: Esp32Transport | null = null;
  status: TransportStatus = { state: 'getrennt', latencyMs: null, reconnects: 0, lastRx: null };
  sentCount = 0;
  private sender = new StateSender(20, 1000);
  private unsub: (() => void)[] = [];
  onStatus: (s: TransportStatus) => void = () => {};
  onMessage: (m: Msg) => void = () => {};

  async connect(kind: TransportKind, opt: { url?: string } = {}): Promise<void> {
    this.disconnect();
    const tr: Esp32Transport = kind === 'websocket' ? new WebSocketTransport(opt.url ?? 'ws://192.168.4.1:81') : kind === 'ble' ? new WebBluetoothTransport() : new WebSerialTransport();
    this.transport = tr;
    this.unsub.push(tr.onStatus((s) => { this.status = s; this.onStatus(s); }), tr.onMessage((m) => this.onMessage(m)));
    await tr.connect();
    this.sender.reset(); this.sentCount = 0;
  }
  disconnect(): void { for (const u of this.unsub) u(); this.unsub = []; this.transport?.disconnect(); this.transport = null; this.status = { ...this.status, state: 'getrennt' }; this.onStatus(this.status); }

  /** Nach jedem Pipeline-Frame aufrufen. Gibt true zurück, wenn gesendet wurde. */
  offer(cs: ContactState, tMs: number): boolean {
    if (!this.transport || this.status.state !== 'verbunden') return false;
    const m = this.sender.offer(tMs, snapshotOf(cs)); if (!m) return false;
    this.transport.send(this.transport.kind === 'ble' ? snapshotOf(cs) : m, m.seq); this.sentCount++; return true;
  }
}
