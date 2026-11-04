/**
 * Live-Pipeline (rein, ohne Browser-APIs): Pose-/Hand-Ergebnisse → Person wählen → Wandkoordinaten →
 * One-Euro-Glättung → Kontakt-Proben → Kontaktlogik. Läuft im Pipeline-Worker und in Tests identisch.
 */
import { applyH, type Mat3 } from '../geometry/homography';
import { DEFAULT_ONE_EURO, OneEuro2D, type OneEuroParams } from '../geometry/oneEuro';
import { ContactMatcher, type ContactConfig, type ContactEvent, type ContactState, type LimbObservation } from '../contact/matcher';
import { LIMBS, type Hold } from '../core/schemas';
import { PersonTracker, type TrackStatus } from '../tracking/person';
import { extractLimb, LM, matchHands, N_POSE, type HandCandidate, type Kp, type PoseCandidate } from '../pose/landmarks';

export interface PipelineConfig {
  holds: readonly Hold[];
  aspekt: number;
  cmPerUnit: number;
  /** Kamerabild (Pixel) → Wand (u,v ∈ 0..1). */
  homography: Mat3;
  frameWidth: number;
  frameHeight: number;
  swapLeftRight: boolean;
  oneEuro: OneEuroParams;
  contact: Partial<ContactConfig>;
}
export const defaultPipelineConfig = (p: Pick<PipelineConfig, 'holds' | 'aspekt' | 'homography' | 'frameWidth' | 'frameHeight'> & Partial<PipelineConfig>): PipelineConfig => ({
  cmPerUnit: 240, swapLeftRight: false, oneEuro: DEFAULT_ONE_EURO, contact: {}, ...p,
});

export interface FrameInput { t: number; poses: readonly PoseCandidate[]; hands: readonly HandCandidate[] }
export interface SkeletonPoint { u: number; v: number; c: number }
export interface FrameOutput {
  t: number;
  status: TrackStatus;
  locked: boolean;
  personIndex: number | null;
  /** 33 geglättete Punkte in Wandkoordinaten (u,v); null wenn keine Person. */
  skeleton: (SkeletonPoint | null)[] | null;
  contact: ContactState;
  events: ContactEvent[];
  /** Zuordnung pausiert (z. B. Kamera bewegt). */
  paused: boolean;
}

/** Laufender Median je Gliedmaße (Segmentlängen in cm) – erkennt unplausibel verlängerte Gliedmaßen (Ausreißer). */
class LengthMonitor {
  private hist = new Map<string, number[]>();
  check(key: string, len: number): 'ok' | 'verdaechtig' | 'ausreisser' {
    const h = this.hist.get(key) ?? [];
    const med = h.length >= 8 ? ([...h].sort((a, b) => a - b)[h.length >> 1] as number) : 0;
    let res: 'ok' | 'verdaechtig' | 'ausreisser' = 'ok';
    if (med > 0) { if (len > 1.6 * med) res = 'ausreisser'; else if (len > 1.3 * med) res = 'verdaechtig'; }
    if (res === 'ok') { h.push(len); if (h.length > 90) h.shift(); this.hist.set(key, h); }
    return res;
  }
}

export class LivePipeline {
  readonly matcher: ContactMatcher;
  readonly tracker: PersonTracker;
  private cfg: PipelineConfig;
  private poseFilters: OneEuro2D[] = [];
  private probeFilters = new Map<string, OneEuro2D>();
  private lengths = new LengthMonitor();
  private paused = false;
  private lastContact: ContactState;

  constructor(cfg: PipelineConfig) {
    this.cfg = cfg;
    this.matcher = new ContactMatcher(cfg.holds, cfg.aspekt, { cmPerUnit: cfg.cmPerUnit, ...cfg.contact });
    this.tracker = new PersonTracker((p) => this.toWallUV(p));
    for (let i = 0; i < N_POSE; i++) this.poseFilters.push(new OneEuro2D(cfg.oneEuro));
    this.lastContact = this.matcher.update(0, []);
  }

  setHomography(h: Mat3): void { this.cfg = { ...this.cfg, homography: h }; this.resetFilters(); }
  setHolds(holds: readonly Hold[]): void { this.cfg = { ...this.cfg, holds }; this.matcher.setHolds(holds, this.cfg.aspekt); }
  setPaused(p: boolean): void { this.paused = p; }
  resetFilters(): void { for (const f of this.poseFilters) f.reset(); this.probeFilters.clear(); }

  /** Bild (normalisiert) → Wand (u,v). */
  toWallUV(p: { x: number; y: number }): { x: number; y: number } {
    const w = applyH(this.cfg.homography, [p.x * this.cfg.frameWidth, p.y * this.cfg.frameHeight]);
    return { x: w[0], y: w[1] };
  }
  private toIso = (k: { x: number; y: number }): { x: number; y: number } => { const w = this.toWallUV(k); return { x: w.x * this.cfg.aspekt, y: w.y }; };

  private filterProbe(key: string, p: { x: number; y: number }, t: number): { x: number; y: number } {
    let f = this.probeFilters.get(key);
    if (!f) { f = new OneEuro2D(this.cfg.oneEuro); this.probeFilters.set(key, f); }
    const cm = this.cfg.cmPerUnit;
    const [x, y] = f.filter(p.x * cm, p.y * cm, t);
    return { x: x / cm, y: y / cm };
  }

  process(inp: FrameInput): FrameOutput {
    const tr = this.tracker.update(inp.t, inp.poses);
    const pose = tr.index !== null ? (inp.poses[tr.index] as PoseCandidate) : null;
    let skeleton: (SkeletonPoint | null)[] | null = null;
    const observations: LimbObservation[] = [];

    if (pose) {
      skeleton = pose.keypoints.slice(0, N_POSE).map((k: Kp, i) => {
        const w = this.toWallUV(k);
        const [fx, fy] = (this.poseFilters[i] as OneEuro2D).filter(w.x * this.cfg.aspekt * this.cfg.cmPerUnit, w.y * this.cfg.cmPerUnit, inp.t);
        return { u: fx / this.cfg.cmPerUnit / this.cfg.aspekt, v: fy / this.cfg.cmPerUnit, c: k.c };
      });
      const hands = matchHands(pose, inp.hands, this.cfg.swapLeftRight);
      for (const limb of LIMBS) {
        const ex = extractLimb(limb, pose, hands[limb as 'LH' | 'RH'], this.toIso, this.cfg.swapLeftRight);
        // Gliedlängen-Plausibilität (Arm: Schulter-Ellbogen-Handgelenk, Bein: Hüfte-Knie-Knöchel)
        const L = limb === 'LH' || limb === 'RH' ? (limb === 'LH' ? [LM.lShoulder, LM.lElbow, LM.lWrist] : [LM.rShoulder, LM.rElbow, LM.rWrist]) : (limb === 'LF' ? [LM.lHip, LM.lKnee, LM.lAnkle] : [LM.rHip, LM.rKnee, LM.rAnkle]);
        const ids = this.cfg.swapLeftRight ? L.map((i) => (i % 2 === 0 ? i - 1 : i + 1)) : L;
        const pts = ids.map((i) => pose.keypoints[i]);
        let plaus = 1;
        if (pts.every((p) => p && p.c > 0.3)) {
          const [a, b, c] = pts.map((p) => this.toIso(p as Kp)) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
          const len = (Math.hypot(a.x - b.x, a.y - b.y) + Math.hypot(b.x - c.x, b.y - c.y)) * this.cfg.cmPerUnit;
          const res = this.lengths.check(limb, len);
          if (res === 'ausreisser') ex.probes = [];
          else if (res === 'verdaechtig') plaus = 0.7;
        }
        const probes = ex.probes.map((p) => ({ ...p, ...this.filterProbe(`${limb}:${p.kind}`, p, inp.t) }));
        observations.push({ limb, probes, evidence: ex.evidence, plaus });
      }
    } else {
      for (const f of this.poseFilters) f.reset();
      this.probeFilters.clear();
    }

    let contact: ContactState;
    let events: ContactEvent[] = [];
    if (this.paused) contact = this.lastContact;
    else { contact = this.matcher.update(inp.t, observations); events = this.matcher.drainEvents(); this.lastContact = contact; }
    return { t: inp.t, status: tr.status, locked: tr.locked, personIndex: tr.index, skeleton, contact, events, paused: this.paused };
  }
}
