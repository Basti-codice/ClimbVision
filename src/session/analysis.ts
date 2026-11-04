/** Auswertungen auf Ereignissen und Zeitreihen. Alle Winkel/Strecken sind 2D-NÄHERUNGEN in der Wandebene. */
import { LIMBS, type ContactEventDoc, type Limb, type Route } from '../core/schemas';
import { N_KP, type ReplayEngine } from './recorder';
import { LM } from '../pose/landmarks';

export interface Move { t: number; limb: Limb; holdId: number; von: number | null }
export interface Pause { von: number; bis: number; dauerMs: number }

/** Zugfolge: jeder Kontaktbeginn/-wechsel an einem Griff. */
export function moveSequence(events: readonly ContactEventDoc[]): Move[] {
  return events.filter((e) => (e.typ === 'start' || e.typ === 'wechsel') && e.holdId !== null).sort((a, b) => a.t - b.t)
    .map((e) => ({ t: e.t, limb: e.limb, holdId: e.holdId as number, von: e.vonHoldId ?? null }));
}
export function timePerMove(moves: readonly Move[]): number[] { return moves.slice(1).map((m, i) => m.t - (moves[i] as Move).t); }
export function pauses(moves: readonly Move[], minMs = 2000): Pause[] {
  const out: Pause[] = [];
  for (let i = 1; i < moves.length; i++) { const d = (moves[i] as Move).t - (moves[i - 1] as Move).t; if (d >= minMs) out.push({ von: (moves[i - 1] as Move).t, bis: (moves[i] as Move).t, dauerMs: d }); }
  return out;
}

export interface Usage { holdId: number; ms: number; limbs: Record<Limb, number> }
/** Griff-Nutzungsdauer je Griff und Gliedmaße (aus Ereignissen; offene Kontakte laufen bis endMs). */
export function holdUsage(events: readonly ContactEventDoc[], endMs: number): Usage[] {
  const open = new Map<Limb, { holdId: number; t: number }>();
  const acc = new Map<number, Usage>();
  const add = (h: number, l: Limb, ms: number): void => { const u = acc.get(h) ?? { holdId: h, ms: 0, limbs: { LH: 0, RH: 0, LF: 0, RF: 0 } }; u.ms += ms; u.limbs[l] += ms; acc.set(h, u); };
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const cur = open.get(e.limb);
    if (cur && (e.typ === 'ende' || e.typ === 'wechsel')) { add(cur.holdId, e.limb, e.t - cur.t); open.delete(e.limb); }
    if ((e.typ === 'start' || e.typ === 'wechsel') && e.holdId !== null) open.set(e.limb, { holdId: e.holdId, t: e.t });
  }
  for (const [l, cur] of open) add(cur.holdId, l, Math.max(0, endMs - cur.t));
  return [...acc.values()].sort((a, b) => b.ms - a.ms);
}

export function leftRight(usage: readonly Usage[]): { links: number; rechts: number; anteilLinks: number; haende: { links: number; rechts: number }; fuesse: { links: number; rechts: number } } {
  let lh = 0, rh = 0, lf = 0, rf = 0;
  for (const u of usage) { lh += u.limbs.LH; rh += u.limbs.RH; lf += u.limbs.LF; rf += u.limbs.RF; }
  const links = lh + lf, rechts = rh + rf;
  return { links, rechts, anteilLinks: links + rechts > 0 ? links / (links + rechts) : 0.5, haende: { links: lh, rechts: rh }, fuesse: { links: lf, rechts: rf } };
}

export type Pt = { u: number; v: number };
/** Winkel am Punkt b zwischen a–b–c in Grad (2D). */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.u - b.u, y: a.v - b.v }, v2 = { x: c.u - b.u, y: c.v - b.v };
  const n = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (n < 1e-12) return NaN;
  return (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / n))) * 180) / Math.PI;
}

export interface Series { t: number[]; hip: Pt[]; com: Pt[]; span: number[]; elbowL: number[]; elbowR: number[]; kneeL: number[]; kneeR: number[]; hipAngleL: number[]; hipAngleR: number[] }
export function seriesFromReplay(rp: ReplayEngine, aspekt: number, cmPerUnit: number): Series {
  const s: Series = { t: [], hip: [], com: [], span: [], elbowL: [], elbowR: [], kneeL: [], kneeR: [], hipAngleL: [], hipAngleR: [] };
  for (let i = 0; i < rp.length; i++) {
    const f = rp.frame(i); if (!f) continue;
    const P = (k: number): Pt | null => { const u = f.kp[k * 3] as number, v = f.kp[k * 3 + 1] as number, c = f.kp[k * 3 + 2] as number; return Number.isFinite(u) && c > 0.3 ? { u: u * aspekt, v } : null; };
    const lh = P(LM.lHip), rh = P(LM.rHip), ls = P(LM.lShoulder), rs = P(LM.rShoulder);
    if (!lh || !rh) continue;
    const hip = { u: (lh.u + rh.u) / 2, v: (lh.v + rh.v) / 2 };
    const torso = [lh, rh, ls, rs].filter((p): p is Pt => !!p);
    s.t.push(f.t); s.hip.push(hip); s.com.push({ u: torso.reduce((a, p) => a + p.u, 0) / torso.length, v: torso.reduce((a, p) => a + p.v, 0) / torso.length });
    const lw = P(LM.lWrist), rw = P(LM.rWrist);
    s.span.push(lw && rw ? Math.hypot(lw.u - rw.u, lw.v - rw.v) * cmPerUnit : NaN);
    const ang = (a: number, b: number, c: number): number => { const A = P(a), B = P(b), C = P(c); return A && B && C ? angleDeg(A, B, C) : NaN; };
    s.elbowL.push(ang(LM.lShoulder, LM.lElbow, LM.lWrist)); s.elbowR.push(ang(LM.rShoulder, LM.rElbow, LM.rWrist));
    s.kneeL.push(ang(LM.lHip, LM.lKnee, LM.lAnkle)); s.kneeR.push(ang(LM.rHip, LM.rKnee, LM.rAnkle));
    s.hipAngleL.push(ang(LM.lShoulder, LM.lHip, LM.lKnee)); s.hipAngleR.push(ang(LM.rShoulder, LM.rHip, LM.rKnee));
  }
  return s;
}
const fin = (a: number[]): number[] => a.filter(Number.isFinite);
export const stat = (a: number[]): { min: number; max: number; mean: number; n: number } => { const f = fin(a); return f.length ? { min: Math.min(...f), max: Math.max(...f), mean: f.reduce((x, y) => x + y, 0) / f.length, n: f.length } : { min: NaN, max: NaN, mean: NaN, n: 0 }; };

export function pathLengthCm(p: readonly Pt[], cmPerUnit: number): number { let l = 0; for (let i = 1; i < p.length; i++) l += Math.hypot((p[i] as Pt).u - (p[i - 1] as Pt).u, (p[i] as Pt).v - (p[i - 1] as Pt).v); return l * cmPerUnit; }
/** Anteil der Zeit mit Hüftgeschwindigkeit über der Schwelle (cm/s) = "dynamisch". */
export function dynamicShare(s: Series, cmPerUnit: number, thresholdCmS = 25): { dynamisch: number; statisch: number } {
  let dyn = 0, tot = 0;
  for (let i = 1; i < s.t.length; i++) { const dt = ((s.t[i] as number) - (s.t[i - 1] as number)) / 1000; if (dt <= 0 || dt > 0.5) continue; const v = (Math.hypot((s.hip[i] as Pt).u - (s.hip[i - 1] as Pt).u, (s.hip[i] as Pt).v - (s.hip[i - 1] as Pt).v) * cmPerUnit) / dt; tot += dt; if (v > thresholdCmS) dyn += dt; }
  return { dynamisch: tot ? dyn / tot : 0, statisch: tot ? 1 - dyn / tot : 0 };
}

export interface Attempt { startMs: number; endMs: number; ende: 'top' | 'sturz' | 'abbruch'; zuege: number }
/**
 * Versuchssegmentierung: Start, sobald beide Hände (oder ≥ 1 Hand, wenn nur ein Startgriff) an Startgriffen liegen;
 * Ende am Topgriff (beide Hände) oder "Sturz", wenn alle Gliedmaßen ≥ freeMs frei sind.
 */
export function segmentAttempts(events: readonly ContactEventDoc[], route: Route, endMs: number, freeMs = 1500): Attempt[] {
  const starts = new Set(route.griffe.filter((g) => g.rolle === 'start').map((g) => g.holdId));
  const tops = new Set(route.griffe.filter((g) => g.rolle === 'top').map((g) => g.holdId));
  const cur: Record<Limb, number | null> = { LH: null, RH: null, LF: null, RF: null };
  const out: Attempt[] = [];
  let open: { start: number; zuege: number } | null = null, freeSince: number | null = null;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const all = (): boolean => LIMBS.every((l) => cur[l] === null);
  for (const e of sorted) {
    if (open && freeSince !== null && e.t - freeSince >= freeMs) { out.push({ startMs: open.start, endMs: freeSince, ende: 'sturz', zuege: open.zuege }); open = null; }
    if (e.typ === 'ende') cur[e.limb] = null; else if (e.holdId !== null) cur[e.limb] = e.holdId;
    const hands = [cur.LH, cur.RH].filter((x): x is number => x !== null);
    if (!open) {
      const onStart = hands.length > 0 && hands.every((h) => starts.has(h)) && (hands.length === 2 || starts.size === 1);
      if (onStart) { open = { start: e.t, zuege: 0 }; freeSince = null; }
    } else {
      if (e.typ !== 'ende') open.zuege++;
      if (cur.LH !== null && cur.RH !== null && tops.has(cur.LH) && tops.has(cur.RH)) { out.push({ startMs: open.start, endMs: e.t, ende: 'top', zuege: open.zuege }); open = null; freeSince = null; continue; }
      freeSince = all() ? (freeSince ?? e.t) : null;
    }
  }
  if (open) {
    if (freeSince !== null && endMs - freeSince >= freeMs) out.push({ startMs: open.start, endMs: freeSince, ende: 'sturz', zuege: open.zuege });
    else out.push({ startMs: open.start, endMs, ende: 'abbruch', zuege: open.zuege });
  }
  return out;
}

/** Soll-/Ist-Abgleich: wie viele Soll-Züge wurden in Reihenfolge getroffen (Subsequenz), welche fehlen, welche Griffe waren zusätzlich. */
export function compareToRoute(moves: readonly Move[], route: Route): { getroffen: number; soll: number; fehlend: { limb: Limb; holdId: number }[]; zusaetzlich: number[]; anteil: number } {
  const soll = route.zugfolge.length ? route.zugfolge : route.griffe.filter((g) => g.rolle !== 'fuss').sort((a, b) => (a.reihenfolge ?? 0) - (b.reihenfolge ?? 0)).map((g) => ({ limb: 'RH' as Limb, holdId: g.holdId }));
  let j = 0; const hit = new Set<number>();
  for (const m of moves) { const t = soll[j]; if (t && m.holdId === t.holdId && (route.zugfolge.length === 0 || m.limb === t.limb)) { hit.add(j); j++; } }
  const sollIds = new Set(route.griffe.map((g) => g.holdId));
  const extra = [...new Set(moves.filter((m) => !sollIds.has(m.holdId)).map((m) => m.holdId))];
  return { getroffen: hit.size, soll: soll.length, fehlend: soll.filter((_, i) => !hit.has(i)).map((s) => ({ limb: s.limb, holdId: s.holdId })), zusaetzlich: extra, anteil: soll.length ? hit.size / soll.length : 0 };
}

export { N_KP };
