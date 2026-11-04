/** MediaPipe-Landmark-Indizes, Pose-Kandidaten und Extraktion der Kontakt-Proben je Gliedmaße. */
import type { Limb } from '../core/schemas';
import type { Probe } from '../contact/matcher';
import type { Evidence } from '../contact/matcher';

export interface Kp { x: number; y: number; c: number } // x,y normalisiert im Bild (0..1), c = Sichtbarkeit 0..1
export interface PoseCandidate { keypoints: Kp[]; score: number }
export interface HandCandidate { /** 21 Landmarks, normalisiert im Bild. */ keypoints: Kp[]; handedness: 'Left' | 'Right' | null; score: number }

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lPinky: 17, rPinky: 18, lIndex: 19, rIndex: 20, lThumb: 21, rThumb: 22,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
} as const;
export const N_POSE = 33;

/** Hand-Landmarks (MediaPipe Hand): 0 Handgelenk, 5/9/13/17 MCP, 8 Zeigefinger-, 12 Mittelfingerspitze. */
export const HL = { wrist: 0, mcp: [5, 9, 13, 17] as const, tipIndex: 8, tipMiddle: 12 } as const;

export interface LimbIdx { wrist: number; pinky: number; index: number; elbow: number; shoulder: number; ankle: number; heel: number; foot: number }
const LEFT: LimbIdx = { wrist: LM.lWrist, pinky: LM.lPinky, index: LM.lIndex, elbow: LM.lElbow, shoulder: LM.lShoulder, ankle: LM.lAnkle, heel: LM.lHeel, foot: LM.lFoot };
const RIGHT: LimbIdx = { wrist: LM.rWrist, pinky: LM.rPinky, index: LM.rIndex, elbow: LM.rElbow, shoulder: LM.rShoulder, ankle: LM.rAnkle, heel: LM.rHeel, foot: LM.rFoot };
/** Von hinten gefilmt kann das Modell links/rechts verwechseln → per Einstellung tauschbar. */
export const limbIdx = (limb: Limb, swap: boolean): LimbIdx => ((limb === 'LH' || limb === 'LF') !== swap ? LEFT : RIGHT);

export type ToIso = (kp: Kp) => { x: number; y: number }; // Bild → isotrope Wandkoordinaten (Einheiten: Wandhöhen)

export interface LimbExtraction { probes: Probe[]; evidence: Evidence }

const mean = (a: { x: number; y: number }[]): { x: number; y: number } => ({ x: a.reduce((s, p) => s + p.x, 0) / a.length, y: a.reduce((s, p) => s + p.y, 0) / a.length });

/** Handlandmarks dem nächstliegenden Pose-Handgelenk zuordnen (max. Abstand in Bildkoordinaten). */
export function matchHands(pose: PoseCandidate, hands: readonly HandCandidate[], swap: boolean, maxDist = 0.12): Partial<Record<'LH' | 'RH', HandCandidate>> {
  const out: Partial<Record<'LH' | 'RH', HandCandidate>> = {};
  for (const limb of ['LH', 'RH'] as const) {
    const w = pose.keypoints[limbIdx(limb, swap).wrist];
    if (!w || w.c < 0.2) continue;
    let best: HandCandidate | null = null, bd = maxDist;
    for (const h of hands) {
      const hw = h.keypoints[HL.wrist];
      if (!hw) continue;
      const d = Math.hypot(hw.x - w.x, hw.y - w.y);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) out[limb] = best;
  }
  // gleiche Hand nicht doppelt vergeben
  if (out.LH && out.LH === out.RH) delete out.RH;
  return out;
}

export function extractLimb(limb: Limb, pose: PoseCandidate, hand: HandCandidate | undefined, toIso: ToIso, swap: boolean): LimbExtraction {
  const idx = limbIdx(limb, swap);
  const k = (i: number): Kp | undefined => pose.keypoints[i];
  const mk = (kind: Probe['kind'], p: { x: number; y: number }, c: number): Probe => ({ kind, x: p.x, y: p.y, c });
  if (limb === 'LH' || limb === 'RH') {
    const wr = k(idx.wrist);
    const probes: Probe[] = [];
    if (wr) probes.push(mk('wrist', toIso(wr), wr.c));
    if (hand && hand.score >= 0.4) {
      const hk = hand.keypoints;
      const mcps = HL.mcp.map((i) => hk[i]).filter((p): p is Kp => !!p);
      if (mcps.length === 4) probes.push(mk('palm', toIso({ ...mean(mcps), c: 1 }), Math.min(...mcps.map((p) => p.c), hand.score)));
      for (const ti of [HL.tipMiddle, HL.tipIndex]) { const t = hk[ti]; if (t) probes.push(mk('tip', toIso(t), Math.min(t.c, hand.score))); }
      return { probes, evidence: 'hand-landmarks' };
    }
    // nur Pose: Knöchel der Finger (Zeige-/Kleinfinger-Landmark) als Handflächen-Näherung
    const pi = k(idx.pinky), ix = k(idx.index);
    if (pi && ix) probes.push(mk('palm', toIso({ x: (pi.x + ix.x) / 2, y: (pi.y + ix.y) / 2, c: 1 }), Math.min(pi.c, ix.c)));
    return { probes, evidence: wr && wr.c >= 0.3 ? 'nur-pose' : 'geschaetzt' };
  }
  const ankle = k(idx.ankle), heel = k(idx.heel), foot = k(idx.foot);
  const probes: Probe[] = [];
  if (foot) probes.push(mk('toe', toIso(foot), foot.c));
  if (heel) probes.push(mk('heel', toIso(heel), heel.c));
  if (ankle) probes.push(mk('ankle', toIso(ankle), ankle.c));
  return { probes, evidence: 'gesehen' };
}

/** Körperhöhen-Proxy (Schulter→Hüfte) in Bildkoordinaten – für Größenvergleich beim Tracking. */
export function torsoLength(p: PoseCandidate): number {
  const s = [LM.lShoulder, LM.rShoulder].map((i) => p.keypoints[i]).filter((x): x is Kp => !!x);
  const h = [LM.lHip, LM.rHip].map((i) => p.keypoints[i]).filter((x): x is Kp => !!x);
  if (!s.length || !h.length) return 0;
  const sm = mean(s), hm = mean(h);
  return Math.hypot(sm.x - hm.x, sm.y - hm.y);
}
export function hipCenter(p: PoseCandidate): { x: number; y: number; c: number } | null {
  const h = [LM.lHip, LM.rHip].map((i) => p.keypoints[i]).filter((x): x is Kp => !!x && x.c > 0.1);
  if (!h.length) return null;
  const m = mean(h);
  return { ...m, c: Math.min(...h.map((x) => x.c)) };
}
export function poseQuality(p: PoseCandidate): number {
  const v = p.keypoints.map((k) => k.c);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
