/**
 * Live-Engine (Main-Thread-Orchestrierung): Frame-Quelle → Pose-Worker (+ Hand-Worker auf ROI) → LivePipeline → UI.
 * Backpressure: höchstens ein Frame pro Worker "in flight"; neue Frames werden verworfen (drop-newest), nie in eine Warteschlange gelegt.
 */
import type { Frame, FrameSource } from '../sources/types';
import type { FrameOutput, LivePipeline } from '../pipeline/live';
import { LM, type HandCandidate, type PoseCandidate } from '../pose/landmarks';

export interface EngineStats { poseHz: number; poseMs: number; handMs: number; latencyMs: number; dropped: number; frames: number; handHz: number }
export interface EngineOptions {
  source: FrameSource; pipeline: LivePipeline; poseModel: ArrayBuffer; handModel: ArrayBuffer | null;
  base?: string; delegate?: 'CPU' | 'GPU'; numPoses?: number; handIntervalMs?: number;
  /** true (Standard): Engine startet/stoppt die Quelle selbst. false: Quelle läuft bereits (Vorschau) und bleibt nach stop() offen. */
  ownsSource?: boolean;
  onOutput: (o: FrameOutput, frame: { width: number; height: number }) => void;
  onStats?: (s: EngineStats) => void; onError?: (m: string) => void; swapLeftRight?: boolean;
}

type PoseRes = { type: 'result'; id: number; t: number; ms: number; poses?: PoseCandidate[]; hands?: HandCandidate[] };

export class LiveEngine {
  private pose: Worker | null = null; private hand: Worker | null = null;
  private poseBusy = false; private handBusy = false;
  private id = 0; private dropped = 0; private frames = 0;
  private lastT = -Infinity;
  private recent: number[] = []; private recentHand: number[] = [];
  private poseMs = 0; private handMs = 0; private latency = 0;
  private lastPoses: PoseCandidate[] = [];
  private hands: { cand: HandCandidate; t: number }[] = [];
  private handTurn = 0; private lastHandT = 0;
  private cloneForHands: ImageBitmap | null = null;
  private off: (() => void) | null = null;
  private pendingLock: { x: number; y: number } | null = null;
  private lastFrame = { width: 0, height: 0 };
  private statsTimer: number | null = null;
  constructor(private readonly o: EngineOptions) {}

  private spawn(kind: 'pose' | 'hand', model: ArrayBuffer): Promise<Worker> {
    return new Promise((resolve, reject) => {
      const w = new Worker('/workers/mediapipe.worker.js'); // classic (importScripts)
      w.onmessage = (e: MessageEvent<{ type: string; message?: string }>) => { if (e.data.type === 'ready') resolve(w); else if (e.data.type === 'error') reject(new Error(e.data.message)); };
      w.onerror = (e) => reject(new Error(e.message || 'Worker-Fehler'));
      w.postMessage({ type: 'init', kind, model: model.slice(0), base: this.o.base ?? '/vendor/mediapipe', delegate: this.o.delegate ?? 'CPU', numPoses: this.o.numPoses ?? 1, numHands: 2, mode: kind === 'pose' ? 'VIDEO' : 'IMAGE' });
    });
  }

  async start(): Promise<void> {
    this.pose = await this.spawn('pose', this.o.poseModel);
    this.pose.onmessage = (e: MessageEvent<PoseRes | { type: 'error'; message: string }>) => this.onPose(e.data);
    if (this.o.handModel) {
      try { this.hand = await this.spawn('hand', this.o.handModel); this.hand.onmessage = (e: MessageEvent<PoseRes | { type: 'error'; message: string }>) => this.onHand(e.data); }
      catch (e) { this.o.onError?.(`Hand-Tracking nicht verfügbar: ${(e as Error).message}`); this.hand = null; }
    }
    this.off = this.o.source.onFrame((f) => this.onFrame(f));
    if (this.o.ownsSource ?? true) await this.o.source.start();
    this.statsTimer = window.setInterval(() => this.o.onStats?.(this.stats()), 500);
  }

  stats(): EngineStats {
    const now = performance.now();
    this.recent = this.recent.filter((t) => now - t < 2000); this.recentHand = this.recentHand.filter((t) => now - t < 2000);
    return { poseHz: this.recent.length / 2, handHz: this.recentHand.length / 2, poseMs: this.poseMs, handMs: this.handMs, latencyMs: this.latency, dropped: this.dropped, frames: this.frames };
  }

  /** "Person sperren": Klick in Bildkoordinaten (0..1) – wird beim nächsten Pose-Ergebnis angewendet. */
  lockAt(click: { x: number; y: number }): void { this.pendingLock = click; }
  unlock(): void { this.o.pipeline.tracker.unlock(); }

  private onFrame(f: Frame): void {
    this.frames++;
    this.lastFrame = { width: f.width, height: f.height };
    if (!this.pose || this.poseBusy) { this.dropped++; f.bitmap.close(); return; }
    // Videodatei läuft in Schleife → Zeit springt zurück: Zustand zurücksetzen
    if (f.captureTime < this.lastT - 500) { this.o.pipeline.matcher.reset(); this.o.pipeline.resetFilters(); }
    this.lastT = f.captureTime;
    this.poseBusy = true;
    const id = ++this.id;
    const tSent = performance.now();
    (this.pose as Worker & { _sent?: Map<number, number> })._sent ??= new Map();
    (this.pose as Worker & { _sent: Map<number, number> })._sent.set(id, tSent);
    // Kopie für Hand-ROI behalten (Original wird zum Worker transferiert)
    if (this.hand && !this.handBusy && performance.now() - this.lastHandT >= (this.o.handIntervalMs ?? 100)) {
      void createImageBitmap(f.bitmap).then((c) => { this.cloneForHands?.close(); this.cloneForHands = c; });
    }
    this.pose.postMessage({ type: 'frame', id, t: f.captureTime, bitmap: f.bitmap }, [f.bitmap]);
  }

  private onPose(m: PoseRes | { type: 'error'; message: string }): void {
    if (m.type === 'error') { this.poseBusy = false; this.o.onError?.(`Pose-Erkennung: ${m.message}`); return; }
    this.poseBusy = false;
    const sent = (this.pose as Worker & { _sent?: Map<number, number> })._sent;
    const t0 = sent?.get(m.id); sent?.delete(m.id);
    const now = performance.now();
    this.poseMs = m.ms; this.latency = t0 ? now - t0 : 0; this.recent.push(now);
    const poses = m.poses ?? [];
    this.lastPoses = poses;
    if (this.pendingLock) { this.o.pipeline.tracker.lockAt(this.pendingLock, poses, m.t); this.pendingLock = null; }
    // Hände: nur frische Ergebnisse (≤ 400 ms)
    this.hands = this.hands.filter((h) => m.t - h.t <= 400);
    const out = this.o.pipeline.process({ t: m.t, poses, hands: this.hands.map((h) => h.cand) });
    this.o.onOutput(out, this.lastFrame);
    this.scheduleHand(out, poses);
  }

  /** Hand-ROI: abwechselnd linke/rechte Hand, Ausschnitt um das Handgelenk der verfolgten Person. */
  private scheduleHand(out: FrameOutput, poses: PoseCandidate[]): void {
    if (!this.hand || this.handBusy || !this.cloneForHands || out.personIndex === null) return;
    if (performance.now() - this.lastHandT < (this.o.handIntervalMs ?? 100)) return;
    const pose = poses[out.personIndex]; if (!pose) return;
    const swap = this.o.swapLeftRight ?? false;
    const wi = (this.handTurn++ % 2 === 0) !== swap ? LM.lWrist : LM.rWrist;
    const el = wi === LM.lWrist ? LM.lElbow : LM.rElbow;
    const w = pose.keypoints[wi], e = pose.keypoints[el];
    if (!w || !e || w.c < 0.4) return;
    const bw = this.cloneForHands.width, bh = this.cloneForHands.height;
    const forearm = Math.hypot((w.x - e.x) * bw, (w.y - e.y) * bh);
    const size = Math.max(96, Math.min(Math.min(bw, bh), forearm * 1.8)); // px
    const cx = w.x * bw, cy = w.y * bh;
    const sx = Math.max(0, Math.min(bw - size, cx - size / 2)), sy = Math.max(0, Math.min(bh - size, cy - size / 2));
    this.handBusy = true; this.lastHandT = performance.now();
    const roi = { x: sx / bw, y: sy / bh, w: size / bw, h: size / bh };
    const src = this.cloneForHands;
    void createImageBitmap(src, Math.round(sx), Math.round(sy), Math.round(size), Math.round(size)).then((crop) => {
      this.hand?.postMessage({ type: 'frame', id: ++this.id, t: out.t, bitmap: crop, roi }, [crop]);
    }).catch(() => { this.handBusy = false; });
  }

  private onHand(m: PoseRes | { type: 'error'; message: string }): void {
    this.handBusy = false;
    if (m.type === 'error') { this.o.onError?.(`Hand-Erkennung: ${m.message}`); return; }
    this.handMs = m.ms; this.recentHand.push(performance.now());
    for (const h of m.hands ?? []) this.hands.push({ cand: h, t: m.t });
    if (this.hands.length > 6) this.hands.splice(0, this.hands.length - 6);
  }

  stop(): void {
    this.off?.(); if (this.o.ownsSource ?? true) this.o.source.stop();
    if (this.statsTimer !== null) clearInterval(this.statsTimer);
    this.pose?.postMessage({ type: 'close' }); this.hand?.postMessage({ type: 'close' });
    this.pose?.terminate(); this.hand?.terminate(); this.pose = this.hand = null;
    this.cloneForHands?.close(); this.cloneForHands = null;
  }
}
