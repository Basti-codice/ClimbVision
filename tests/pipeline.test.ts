import { describe, expect, it } from 'vitest';
import { LivePipeline, defaultPipelineConfig } from '../src/pipeline/live';
import { PersonTracker } from '../src/tracking/person';
import { makePose } from './helpers';
import { makeHold } from '../src/holds/editor';
import { wallHomographyFromCorners, type Vec2 } from '../src/geometry/homography';
import { extractLimb, matchHands, LM, type HandCandidate } from '../src/pose/landmarks';

// Kamera 1000×800 px; Wand füllt das Bild vollständig (Ecken = Bildecken) → uv = (x,y) normalisiert
const FW = 1000, FH = 800;
const H = wallHomographyFromCorners([[0, 0], [FW, 0], [FW, FH], [0, FH]]);
const sq = (u: number, v: number, w: number, h: number): Vec2[] => [[u, v], [u + w, v], [u + w, v + h], [u, v + h]];
const holds = [makeHold(1, sq(0.38, 0.28, 0.06, 0.06), 'auto', 0.004), makeHold(2, sq(0.60, 0.28, 0.06, 0.06), 'auto', 0.004), makeHold(3, sq(0.4, 0.8, 0.06, 0.06), 'auto', 0.004)];
const cfg = () => defaultPipelineConfig({ holds, aspekt: 1.25, homography: H, frameWidth: FW, frameHeight: FH });

describe('Person-Tracking', () => {
  const toWall = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
  it('wählt ohne Sperre die Person in der Wandmitte mit guter Qualität', () => {
    const t = new PersonTracker(toWall);
    const r = t.update(0, [makePose(0.5, 0.5), makePose(1.4, 0.5, 0.1)]); // zweite Person außerhalb der Wand
    expect(r.index).toBe(0);
    expect(r.status).toBe('verfolgt');
  });
  it('Sperre per Klick: bleibt auf der gesperrten Person, auch wenn andere größer/zentraler sind', () => {
    const t = new PersonTracker(toWall);
    const a = makePose(0.3, 0.5, 0.15), b = makePose(0.7, 0.5, 0.25);
    expect(t.lockAt({ x: 0.3, y: 0.5 }, [a, b], 0)).toBe(true);
    for (let i = 1; i <= 30; i++) {
      const r = t.update(i * 33, [makePose(0.3 + i * 0.002, 0.5, 0.15), makePose(0.7, 0.5, 0.25)]);
      expect(r.index).toBe(0);
    }
  });
  it('kurze Verdeckung: Sperre bleibt, nach Rückkehr wird dieselbe Person wiedergefunden; lange Verdeckung → verloren', () => {
    const t = new PersonTracker(toWall);
    t.lockAt({ x: 0.3, y: 0.5 }, [makePose(0.3, 0.5, 0.15)], 0);
    expect(t.update(500, []).status).toBe('verdeckt');
    expect(t.update(1500, []).status).toBe('verdeckt');
    expect(t.update(3000, []).status).toBe('verloren');
    expect(t.isLocked).toBe(true);
    const back = t.update(3100, [makePose(0.32, 0.52, 0.15)]);
    expect(back.index).toBe(0);
    expect(back.status).toBe('verfolgt');
  });
  it('fremde Person mit sehr anderer Größe an anderer Stelle wird nicht übernommen', () => {
    const t = new PersonTracker(toWall);
    t.lockAt({ x: 0.3, y: 0.5 }, [makePose(0.3, 0.5, 0.15)], 0);
    const r = t.update(100, [makePose(0.9, 0.9, 0.35)]);
    expect(r.index).toBeNull();
  });
  it('Klick ins Leere sperrt nichts / ohne Kandidaten false', () => {
    const t = new PersonTracker(toWall);
    expect(t.lockAt({ x: 0.5, y: 0.5 }, [], 0)).toBe(false);
  });
});

describe('Pose → Proben', () => {
  const toIso = (k: { x: number; y: number }) => ({ x: k.x * 1.25, y: k.y });
  it('Hand mit Hand-Landmarks: palm + tips, Evidenz hand-landmarks; ohne: nur Pose mit Handflächen-Näherung', () => {
    const pose = makePose(0.5, 0.5);
    const w = pose.keypoints[LM.rWrist]!;
    const hand: HandCandidate = { handedness: 'Right', score: 0.9, keypoints: Array.from({ length: 21 }, (_, i) => ({ x: w.x + (i === 0 ? 0 : 0.01), y: w.y - (i === 12 || i === 8 ? 0.04 : i === 0 ? 0 : 0.02), c: 0.9 })) };
    const hands = matchHands(pose, [hand], false);
    expect(hands.RH).toBe(hand);
    const withHand = extractLimb('RH', pose, hands.RH, toIso, false);
    expect(withHand.evidence).toBe('hand-landmarks');
    expect(withHand.probes.map((p) => p.kind)).toEqual(['wrist', 'palm', 'tip', 'tip']);
    const poseOnly = extractLimb('RH', pose, undefined, toIso, false);
    expect(poseOnly.evidence).toBe('nur-pose');
    expect(poseOnly.probes.map((p) => p.kind)).toEqual(['wrist', 'palm']);
  });
  it('Fuß: Zehe, Ferse, Knöchel; Links/Rechts-Tausch wählt die andere Seite', () => {
    const pose = makePose(0.5, 0.5);
    const a = extractLimb('LF', pose, undefined, toIso, false), b = extractLimb('LF', pose, undefined, toIso, true);
    expect(a.probes.map((p) => p.kind)).toEqual(['toe', 'heel', 'ankle']);
    expect(a.probes[0]!.x).toBeLessThan(b.probes[0]!.x);
  });
  it('weit entfernte Hand wird dem Handgelenk nicht zugeordnet', () => {
    const pose = makePose(0.5, 0.5);
    const far: HandCandidate = { handedness: 'Left', score: 0.9, keypoints: Array.from({ length: 21 }, () => ({ x: 0.05, y: 0.05, c: 0.9 })) };
    expect(matchHands(pose, [far], false)).toEqual({});
  });
});

describe('Live-Pipeline (End-to-End mit synthetischen Posen)', () => {
  // Rechtes Handgelenk bei (0.4+0.03, 0.3+0.03)=Mitte von Griff 1
  const poseWithRH = (hx: number, hy: number, wx: number, wy: number, extra: Record<number, object> = {}) =>
    makePose(hx, hy, 0.2, { 16: { x: wx, y: wy }, 18: { x: wx, y: wy }, 20: { x: wx, y: wy }, 22: { x: wx, y: wy }, ...extra });
  it('rechte Hand ruht auf Griff 1 → Kontakt RH=1; Skelett in Wandkoordinaten; Ereignis genau einmal', () => {
    const p = new LivePipeline(cfg());
    let events = 0; let last = p.process({ t: 0, poses: [], hands: [] });
    for (let t = 0; t <= 2000; t += 33) { last = p.process({ t, poses: [poseWithRH(0.45, 0.5, 0.41, 0.31)], hands: [] }); events += last.events.filter((e) => e.typ === 'start').length; }
    expect(last.contact.limbs.RH.holdId).toBe(1);
    expect(events).toBe(1);
    expect(last.skeleton).not.toBeNull();
    expect(last.skeleton![16]!.u).toBeCloseTo(0.41, 1);
    expect(last.status).toBe('verfolgt');
  });
  it('Person verschwindet kurz (Verdeckung): Kontakt wird gehalten und verfällt erst später', () => {
    const p = new LivePipeline(cfg());
    for (let t = 0; t <= 1500; t += 33) p.process({ t, poses: [poseWithRH(0.45, 0.5, 0.41, 0.31)], hands: [] });
    let o = p.process({ t: 1700, poses: [], hands: [] });
    expect(o.contact.limbs.RH.state).toBe('OCCLUDED_HOLD');
    for (let t = 1733; t <= 5000; t += 33) o = p.process({ t, poses: [], hands: [] });
    expect(o.contact.limbs.RH.state).toBe('FREE');
  });
  it('pausiert (Kamera bewegt): Zustand wird eingefroren, keine neuen Ereignisse', () => {
    const p = new LivePipeline(cfg());
    for (let t = 0; t <= 1500; t += 33) p.process({ t, poses: [poseWithRH(0.45, 0.5, 0.41, 0.31)], hands: [] });
    p.setPaused(true);
    const o = p.process({ t: 1600, poses: [poseWithRH(0.45, 0.5, 0.9, 0.9)], hands: [] });
    expect(o.paused).toBe(true);
    expect(o.events.length).toBe(0);
    expect(o.contact.limbs.RH.holdId).toBe(1);
    p.setPaused(false);
  });
  it('Verlängerte Gliedmaße (Ausreißer-Handgelenk) erzeugt keinen falschen Kontakt', () => {
    const p = new LivePipeline(cfg());
    for (let t = 0; t <= 1000; t += 33) p.process({ t, poses: [poseWithRH(0.45, 0.5, 0.5, 0.45)], hands: [] }); // normale Armlänge, kein Kontakt
    let o = p.process({ t: 1033, poses: [poseWithRH(0.45, 0.5, 0.41, 0.31)], hands: [] });
    for (let t = 1066; t <= 1300; t += 33) o = p.process({ t, poses: [poseWithRH(0.45, 0.5, 0.41, 0.31)], hands: [] });
    expect(o.contact.limbs.RH.holdId).toBeNull(); // Handgelenk ≫ Armlänge entfernt → verworfen
  });
  it('Links/Rechts-Tausch macht aus RH → LH', () => {
    const c = { ...cfg(), swapLeftRight: true };
    const p = new LivePipeline(c);
    let o = p.process({ t: 0, poses: [], hands: [] });
    // linkes Handgelenk (15) auf Griff 1 → bei swap zählt es als RH
    const pose = makePose(0.45, 0.5, 0.2, { 15: { x: 0.41, y: 0.31 }, 17: { x: 0.41, y: 0.31 }, 19: { x: 0.41, y: 0.31 }, 21: { x: 0.41, y: 0.31 } });
    for (let t = 0; t <= 2000; t += 33) o = p.process({ t, poses: [pose], hands: [] });
    expect(o.contact.limbs.RH.holdId).toBe(1);
  });
});
