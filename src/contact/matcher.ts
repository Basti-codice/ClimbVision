/**
 * Kontaktlogik: ordnet Gliedmaßen (LH/RH/LF/RF) Griffen zu.
 * Rein deterministisch: Eingabe = Beobachtungen in isotropen Wandkoordinaten + Zeit, Ausgabe = Zustand + Ereignisse.
 * Einheiten: Koordinaten in "Wandhöhen" (x = u·aspekt, y = v); Toleranzen in cm werden über cmPerUnit umgerechnet.
 */
import type { Hold, Limb } from '../core/schemas';
import { LIMBS } from '../core/schemas';
import { signedDistance } from '../geometry/polygon';
import type { Vec2 } from '../geometry/homography';

export type Evidence = 'gesehen' | 'hand-landmarks' | 'nur-pose' | 'geschaetzt';
export type LimbState = 'FREE' | 'CANDIDATE' | 'CONTACT' | 'HOLDING' | 'OCCLUDED_HOLD' | 'LEAVING';
export type ProbeKind = 'wrist' | 'palm' | 'tip' | 'toe' | 'heel' | 'ankle';

export interface Probe { kind: ProbeKind; x: number; y: number; c: number }
export interface LimbObservation {
  limb: Limb;
  probes: Probe[];
  evidence: Evidence;
  /** 0.5..1, vom Aufrufer (z. B. Gliedlängen-Plausibilität). */
  plaus?: number;
}

export interface ContactConfig {
  cmPerUnit: number;
  tolHandCm: number; tolFootCm: number;
  vLoHand: number; vHiHand: number; vLoFoot: number; vHiFoot: number; // cm/s
  dwellHandMs: number; dwellFootMs: number;
  thetaCand: number; thetaOn: number; thetaOff: number;
  minOnMs: number; minOffMs: number; stableMs: number;
  holdHandMs: number; holdFootMs: number; decayHandMs: number; decayFootMs: number;
  switchMargin: number; ambiguityRatio: number;
  minProbeConf: number;
  capNurPose: number;
  maxJumpCmPerS: number;
  /** Fenster für die Geschwindigkeitsschätzung (unterdrückt Rauschen). */
  speedWindowMs: number;
}

export const DEFAULT_CONTACT_CONFIG: ContactConfig = {
  cmPerUnit: 240,
  tolHandCm: 4, tolFootCm: 5,
  vLoHand: 10, vHiHand: 60, vLoFoot: 8, vHiFoot: 50,
  dwellHandMs: 150, dwellFootMs: 200,
  thetaCand: 0.45, thetaOn: 0.65, thetaOff: 0.4,
  minOnMs: 100, minOffMs: 100, stableMs: 300,
  holdHandMs: 400, holdFootMs: 600, decayHandMs: 800, decayFootMs: 1200,
  switchMargin: 0.15, ambiguityRatio: 0.8,
  minProbeConf: 0.3,
  capNurPose: 0.7,
  maxJumpCmPerS: 600,
  speedWindowMs: 250,
};

export interface Candidate { holdId: number; score: number; distanceCm: number }
export interface LimbStatus {
  limb: Limb;
  state: LimbState;
  holdId: number | null;
  confidence: number;
  evidence: Evidence;
  ambiguous: boolean;
  candidates: Candidate[];
  flags: string[];
  /** Score-Zerlegung des besten Kandidaten (Debug). */
  debug?: { pos: number; speed: number; dwell: number; plaus: number; cap: number };
}
export interface ContactEvent {
  t: number; limb: Limb; typ: 'start' | 'ende' | 'wechsel';
  holdId: number | null; vonHoldId: number | null; score: number; evidenz: Evidence;
}
export interface ContactState { t: number; limbs: Record<Limb, LimbStatus>; aktiveGriffe: number[] }

const isHand = (l: Limb): boolean => l === 'LH' || l === 'RH';
const smooth = (e0: number, e1: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

const PROBE_W: Record<ProbeKind, number> = { palm: 1, tip: 1, wrist: 0.6, toe: 1, heel: 1, ankle: 0.4 };
const PROBE_TOL_MULT: Record<ProbeKind, number> = { palm: 1, tip: 1, wrist: 2, toe: 1, heel: 1, ankle: 2 };

interface IsoHold { id: number; poly: Vec2[]; bbox: [number, number, number, number]; tiefe: number; diag: number }

interface Track {
  state: LimbState;
  holdId: number | null;
  tStart: number;          // Beginn des aktuellen Kontakts (rückdatiert)
  tEnd: number;            // Ende des letzten Kontakts
  tLastGood: number;
  sLast: number;           // letzter gültiger Score des aktuellen Griffs
  evLast: Evidence;
  inSince: Map<number, number>;
  lead: Vec2 | null;
  tLead: number;
  hist: { t: number; p: Vec2 }[]; // Positionsverlauf für fensterbasierte Geschwindigkeit
  speed: number;           // cm/s über speedWindowMs
  candSince: number | null;
}

export class ContactMatcher {
  private readonly iso: IsoHold[] = [];
  private tracks = new Map<Limb, Track>();
  private events: ContactEvent[] = [];
  readonly cfg: ContactConfig;

  constructor(holds: readonly Hold[], aspekt: number, cfg: Partial<ContactConfig> = {}) {
    this.cfg = { ...DEFAULT_CONTACT_CONFIG, ...cfg };
    this.setHolds(holds, aspekt);
    this.reset();
  }

  setHolds(holds: readonly Hold[], aspekt: number): void {
    this.iso.length = 0;
    for (const h of holds) {
      const poly = h.polygon.map((p) => [p[0] * aspekt, p[1]] as Vec2);
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      this.iso.push({ id: h.id, poly, bbox, tiefe: h.tiefe_cm, diag: Math.hypot(bbox[2] - bbox[0], bbox[3] - bbox[1]) });
    }
  }

  reset(): void {
    this.tracks.clear();
    this.events = [];
    for (const l of LIMBS) this.tracks.set(l, { state: 'FREE', holdId: null, tStart: 0, tEnd: -1e9, tLastGood: 0, sLast: 0, evLast: 'gesehen', inSince: new Map(), lead: null, tLead: 0, hist: [], speed: 0, candSince: null });
  }

  /** Ereignisse seit dem letzten Aufruf. */
  drainEvents(): ContactEvent[] { const e = this.events; this.events = []; return e; }

  update(t: number, observations: readonly LimbObservation[]): ContactState {
    const limbs = {} as Record<Limb, LimbStatus>;
    for (const l of LIMBS) {
      const obs = observations.find((o) => o.limb === l) ?? null;
      limbs[l] = this.updateLimb(l, t, obs);
    }
    const active = new Set<number>();
    for (const l of LIMBS) { const s = limbs[l]; if (s.holdId !== null && (s.state === 'CONTACT' || s.state === 'HOLDING' || s.state === 'OCCLUDED_HOLD')) active.add(s.holdId); }
    return { t, limbs, aktiveGriffe: [...active].sort((a, b) => a - b) };
  }

  private emit(e: ContactEvent): void { this.events.push(e); }

  private updateLimb(limb: Limb, t: number, obs: LimbObservation | null): LimbStatus {
    const c = this.cfg, tr = this.tracks.get(limb) as Track;
    const hand = isHand(limb);
    const tolCm = hand ? c.tolHandCm : c.tolFootCm;
    const tol = tolCm / c.cmPerUnit;
    const holdMs = hand ? c.holdHandMs : c.holdFootMs, decayMs = hand ? c.decayHandMs : c.decayFootMs;
    const usable = obs ? obs.probes.filter((p) => p.c >= c.minProbeConf && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
    const flags: string[] = [];

    // ---------- verdeckt / fehlend ----------
    if (!obs || usable.length === 0) {
      if (tr.state === 'CONTACT' || tr.state === 'HOLDING' || tr.state === 'OCCLUDED_HOLD') {
        const elapsed = t - tr.tLastGood;
        const sEff = elapsed <= holdMs ? tr.sLast : tr.sLast * Math.exp(-(elapsed - holdMs) / decayMs);
        if (sEff < c.thetaOff && t - tr.tStart >= c.minOnMs) {
          this.emit({ t, limb, typ: 'ende', holdId: tr.holdId, vonHoldId: null, score: sEff, evidenz: 'geschaetzt' });
          tr.state = 'FREE'; tr.tEnd = t; const old = tr.holdId; tr.holdId = null; tr.candSince = null; tr.inSince.clear();
          return { limb, state: 'FREE', holdId: null, confidence: 0, evidence: 'geschaetzt', ambiguous: false, candidates: [], flags: ['verdeckt', old !== null ? 'kontakt_verloren' : ''].filter(Boolean) };
        }
        tr.state = 'OCCLUDED_HOLD';
        return { limb, state: 'OCCLUDED_HOLD', holdId: tr.holdId, confidence: sEff, evidence: 'geschaetzt', ambiguous: false, candidates: tr.holdId !== null ? [{ holdId: tr.holdId, score: sEff, distanceCm: NaN }] : [], flags: ['verdeckt'] };
      }
      tr.state = 'FREE'; tr.candSince = null; tr.inSince.clear();
      return { limb, state: 'FREE', holdId: null, confidence: 0, evidence: 'geschaetzt', ambiguous: false, candidates: [], flags: ['keine_daten'] };
    }

    // ---------- Geschwindigkeit der führenden Position ----------
    let wsum = 0, lx = 0, ly = 0;
    for (const p of usable) { const w = PROBE_W[p.kind] * p.c; wsum += w; lx += p.x * w; ly += p.y * w; }
    const lead: Vec2 = [lx / wsum, ly / wsum];
    let plaus = obs.plaus ?? 1;
    if (tr.lead) {
      const dt = Math.max(1, t - tr.tLead) / 1000;
      const vInst = (Math.hypot(lead[0] - tr.lead[0], lead[1] - tr.lead[1]) * c.cmPerUnit) / dt;
      if (vInst > c.maxJumpCmPerS) { plaus = Math.min(plaus, 0.5); flags.push('sprung'); tr.hist.length = 0; }
    }
    tr.hist.push({ t, p: lead });
    while (tr.hist.length > 1 && t - (tr.hist[0] as { t: number }).t > c.speedWindowMs) tr.hist.shift();
    {
      const first = tr.hist[0] as { t: number; p: Vec2 };
      const span = t - first.t;
      // Geschwindigkeit = Verschiebung über das Fenster (Rauschen mittelt sich heraus); bei < 100 ms Verlauf unbekannt → 0
      tr.speed = span >= 100 ? (Math.hypot(lead[0] - first.p[0], lead[1] - first.p[1]) * c.cmPerUnit) / (span / 1000) : 0;
    }
    tr.lead = lead; tr.tLead = t;
    const vLo = hand ? c.vLoHand : c.vLoFoot, vHi = hand ? c.vHiHand : c.vHiFoot;
    const sSpeed = 1 - smooth(vLo, vHi, tr.speed);
    const cap = obs.evidence === 'nur-pose' && hand ? c.capNurPose : 1;
    const plausC = Math.max(0.5, Math.min(1, plaus));

    // ---------- Kandidaten ----------
    const margin = 3 * tol * 2;
    const scored: { id: number; pos: number; dwell: number; S: number; distCm: number }[] = [];
    for (const h of this.iso) {
      let near = false;
      for (const p of usable) if (p.x >= h.bbox[0] - margin && p.x <= h.bbox[2] + margin && p.y >= h.bbox[1] - margin && p.y <= h.bbox[3] + margin) { near = true; break; }
      if (!near) { tr.inSince.delete(h.id); continue; }
      const tauH = tol + (0.3 * h.tiefe) / c.cmPerUnit;
      let pos = 0, dMin = Infinity;
      for (const p of usable) {
        const d = signedDistance([p.x, p.y], h.poly);
        dMin = Math.min(dMin, d);
        const tp = tauH * PROBE_TOL_MULT[p.kind];
        const f = d <= 0 ? 1 : Math.exp(-((d / tp) ** 2));
        pos = Math.max(pos, PROBE_W[p.kind] * p.c * f);
      }
      let since = tr.inSince.get(h.id);
      if (pos >= 0.5) { if (since === undefined) { since = t; tr.inSince.set(h.id, t); } } else { since = undefined; tr.inSince.delete(h.id); }
      const tDwell = hand ? c.dwellHandMs : c.dwellFootMs;
      const dwell = since === undefined ? 0 : Math.min(1, (t - since) / tDwell);
      const S = cap * pos * sSpeed * (0.5 + 0.5 * dwell) * plausC;
      if (pos > 0.02) scored.push({ id: h.id, pos, dwell, S, distCm: dMin * c.cmPerUnit });
    }
    scored.sort((a, b) => b.S - a.S);
    const best = scored[0], second = scored[1];
    const candidates: Candidate[] = scored.slice(0, 3).map((s) => ({ holdId: s.id, score: s.S, distanceCm: s.distCm }));
    const ambiguous = !!best && !!second && best.S >= c.thetaCand && second.S / best.S > c.ambiguityRatio;
    if (ambiguous) flags.push('mehrdeutig');
    const debug = best ? { pos: best.pos, speed: sSpeed, dwell: best.dwell, plaus: plausC, cap } : undefined;
    const evidence: Evidence = obs.evidence;
    tr.tLastGood = t;

    // ---------- Zustandsautomat ----------
    const cur = tr.holdId;
    const inContact = tr.state === 'CONTACT' || tr.state === 'HOLDING' || tr.state === 'OCCLUDED_HOLD' || tr.state === 'LEAVING';
    if (inContact && cur !== null) {
      // Fortsetzung eines Kontakts: Geschwindigkeit und Verweildauer blockieren nur den START, nicht das Halten (Hysterese)
      const curRaw = scored.find((s) => s.id === cur);
      const sCur = curRaw ? cap * curRaw.pos * plausC * (0.6 + 0.4 * sSpeed) : 0;
      // Wechsel zu deutlich besserem Griff?
      if (best && best.id !== cur && best.S >= c.thetaOn && best.dwell >= 1 && best.S >= sCur + c.switchMargin) {
        this.emit({ t, limb, typ: 'wechsel', holdId: best.id, vonHoldId: cur, score: best.S, evidenz: evidence });
        tr.holdId = best.id; tr.tStart = t; tr.sLast = best.S; tr.state = 'CONTACT'; tr.evLast = evidence;
        return { limb, state: 'CONTACT', holdId: best.id, confidence: best.S, evidence, ambiguous, candidates, flags, ...(debug ? { debug } : {}) };
      }
      if (sCur < c.thetaOff && t - tr.tStart >= c.minOnMs) {
        this.emit({ t, limb, typ: 'ende', holdId: cur, vonHoldId: null, score: sCur, evidenz: evidence });
        tr.state = 'FREE'; tr.holdId = null; tr.tEnd = t; tr.candSince = null; tr.inSince.delete(cur);
        return { limb, state: 'FREE', holdId: null, confidence: 0, evidence, ambiguous, candidates, flags: [...flags, 'kontakt_beendet'], ...(debug ? { debug } : {}) };
      }
      // Kontakt hält
      tr.sLast = sCur;
      tr.state = t - tr.tStart >= c.stableMs ? 'HOLDING' : 'CONTACT';
      tr.evLast = evidence;
      return { limb, state: tr.state, holdId: cur, confidence: sCur, evidence, ambiguous, candidates, flags, ...(debug ? { debug } : {}) };
    }

    // kein Kontakt: Kandidat/Start
    if (best && best.S >= c.thetaCand) {
      if (tr.candSince === null) tr.candSince = t;
      if (best.S >= c.thetaOn && best.dwell >= 1 && t - tr.tEnd >= c.minOffMs) {
        const tStart = best.dwell >= 1 ? Math.min(t, tr.candSince) : t; // Dwell-Latenz zurückdatieren
        this.emit({ t: tStart, limb, typ: 'start', holdId: best.id, vonHoldId: null, score: best.S, evidenz: evidence });
        tr.state = 'CONTACT'; tr.holdId = best.id; tr.tStart = tStart; tr.sLast = best.S; tr.evLast = evidence; tr.candSince = null;
        return { limb, state: 'CONTACT', holdId: best.id, confidence: best.S, evidence, ambiguous, candidates, flags, ...(debug ? { debug } : {}) };
      }
      tr.state = 'CANDIDATE';
      return { limb, state: 'CANDIDATE', holdId: null, confidence: best.S, evidence, ambiguous, candidates, flags, ...(debug ? { debug } : {}) };
    }
    tr.state = 'FREE'; tr.candSince = null;
    return { limb, state: 'FREE', holdId: null, confidence: best?.S ?? 0, evidence, ambiguous: false, candidates, flags, ...(debug ? { debug } : {}) };
  }
}
