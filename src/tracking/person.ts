/**
 * Person-Tracking: genau EINE Person. Auswahl ohne Sperre über Wandposition/Größe/Qualität/Kontinuität;
 * nach "Person sperren" Zuordnung über Vorhersage der Hüfte (Wandkoordinaten) und Körpergröße.
 */
import { hipCenter, poseQuality, torsoLength, type PoseCandidate } from '../pose/landmarks';

export type TrackStatus = 'suche' | 'verfolgt' | 'verdeckt' | 'verloren';
export interface TrackerConfig {
  /** Zeit ohne Zuordnung, nach der "verloren" gemeldet wird (die Sperre bleibt bestehen). */
  lostAfterMs: number;
  /** Basis-Zuordnungsradius in Wandhöhen. */
  gateBase: number;
  /** Zulässige relative Größenabweichung beim Wiederfinden. */
  sizeTol: number;
}
export const DEFAULT_TRACKER: TrackerConfig = { lostAfterMs: 2000, gateBase: 0.25, sizeTol: 0.5 };

export interface TrackerResult { index: number | null; status: TrackStatus; locked: boolean; hipWall: { x: number; y: number } | null }

/** Bild→Wand-Funktion für Hüftpunkte (Wandkoordinaten u,v; Wand = 0..1). */
export type ToWallUV = (p: { x: number; y: number }) => { x: number; y: number };

export class PersonTracker {
  private locked = false;
  private pos: { x: number; y: number } | null = null;
  private vel = { x: 0, y: 0 };
  private tPos = 0;
  private size = 0;
  private lastSeen = 0;
  private status: TrackStatus = 'suche';
  constructor(private readonly toWall: ToWallUV, private readonly cfg: TrackerConfig = DEFAULT_TRACKER) {}

  get isLocked(): boolean { return this.locked; }
  unlock(): void { this.locked = false; this.pos = null; this.vel = { x: 0, y: 0 }; this.status = 'suche'; }

  /** "Person sperren": nimmt die Pose, deren Hüfte/Torso dem Klickpunkt (Bildkoordinaten) am nächsten liegt. */
  lockAt(click: { x: number; y: number }, candidates: readonly PoseCandidate[], t: number): boolean {
    let best = -1, bd = Infinity;
    candidates.forEach((p, i) => {
      const xs = p.keypoints.filter((k) => k.c > 0.2).map((k) => k.x), ys = p.keypoints.filter((k) => k.c > 0.2).map((k) => k.y);
      if (!xs.length) return;
      const inside = click.x >= Math.min(...xs) - 0.02 && click.x <= Math.max(...xs) + 0.02 && click.y >= Math.min(...ys) - 0.02 && click.y <= Math.max(...ys) + 0.02;
      const hip = hipCenter(p);
      const d = hip ? Math.hypot(hip.x - click.x, hip.y - click.y) : Infinity;
      const score = inside ? d : d + 1;
      if (score < bd) { bd = score; best = i; }
    });
    if (best < 0) return false;
    const p = candidates[best] as PoseCandidate;
    const hip = hipCenter(p);
    if (!hip) return false;
    this.locked = true;
    this.pos = this.toWall(hip); this.vel = { x: 0, y: 0 }; this.tPos = t; this.lastSeen = t;
    this.size = torsoLength(p); this.status = 'verfolgt';
    return true;
  }

  private predicted(t: number): { x: number; y: number } | null {
    if (!this.pos) return null;
    const dt = Math.min(2, (t - this.tPos) / 1000);
    return { x: this.pos.x + this.vel.x * dt, y: this.pos.y + this.vel.y * dt };
  }

  update(t: number, candidates: readonly PoseCandidate[]): TrackerResult {
    const infos = candidates.map((p, i) => ({ i, p, hip: hipCenter(p), size: torsoLength(p), q: poseQuality(p) }));
    const valid = infos.filter((x) => x.hip && x.hip.c > 0.15);
    const pred = this.predicted(t);
    const sinceSeen = t - this.lastSeen;

    let chosen: (typeof valid)[number] | null = null;
    if (this.locked && pred) {
      const gate = this.cfg.gateBase + Math.hypot(this.vel.x, this.vel.y) * Math.min(1, sinceSeen / 1000) + (sinceSeen > this.cfg.lostAfterMs ? 0.4 : 0);
      let bd = Infinity;
      for (const c of valid) {
        const w = this.toWall(c.hip as { x: number; y: number });
        const d = Math.hypot(w.x - pred.x, w.y - pred.y);
        const sizeOk = this.size <= 0 || c.size <= 0 || Math.abs(c.size - this.size) / this.size <= this.cfg.sizeTol;
        if (d <= gate && sizeOk && d < bd) { bd = d; chosen = c; }
      }
    } else if (!this.locked) {
      let bs = -Infinity;
      for (const c of valid) {
        const w = this.toWall(c.hip as { x: number; y: number });
        const inWall = w.x > -0.05 && w.x < 1.05 && w.y > -0.05 && w.y < 1.05 ? 1 : 0;
        const cont = pred ? Math.max(0, 1 - Math.hypot(w.x - pred.x, w.y - pred.y) / 0.4) : 0;
        const sizeScore = Math.min(1, c.size / 0.15);
        const score = 0.35 * inWall + 0.2 * sizeScore + 0.2 * c.q + 0.25 * cont;
        if (score > bs) { bs = score; chosen = c; }
      }
    }

    if (chosen) {
      const w = this.toWall(chosen.hip as { x: number; y: number });
      if (this.pos) {
        const dt = Math.max(0.001, (t - this.tPos) / 1000);
        const a = 0.4;
        this.vel = { x: this.vel.x * (1 - a) + ((w.x - this.pos.x) / dt) * a, y: this.vel.y * (1 - a) + ((w.y - this.pos.y) / dt) * a };
      }
      this.pos = w; this.tPos = t; this.lastSeen = t;
      if (chosen.size > 0) this.size = this.size > 0 ? this.size * 0.9 + chosen.size * 0.1 : chosen.size;
      this.status = 'verfolgt';
      return { index: chosen.i, status: 'verfolgt', locked: this.locked, hipWall: w };
    }
    if (this.pos) this.status = sinceSeen > this.cfg.lostAfterMs ? 'verloren' : 'verdeckt';
    else this.status = 'suche';
    return { index: null, status: this.status, locked: this.locked, hipWall: null };
  }
}
