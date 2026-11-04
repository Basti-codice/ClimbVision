import { describe, expect, it } from 'vitest';
import { ContactMatcher, type ContactEvent, type ContactState, type LimbObservation, type Probe } from '../src/contact/matcher';
import { makeHold } from '../src/holds/editor';
import type { Hold, Limb } from '../src/core/schemas';
import type { Vec2 } from '../src/geometry/homography';

// Wand 300×240 cm → aspekt 1.25; Holds in normalisierten Koordinaten. 1 cm = 1/240 Einheit; x_iso = u·1.25
const ASPEKT = 1.25, CM = 240;
const cm = (x: number): number => x / CM;
/** Kreisförmiger Griff (8 Eck-Näherung) mit Mittelpunkt in cm (Wand: x 0..300, y 0..240) und Radius in cm. */
const hold = (id: number, xcm: number, ycm: number, rcm: number, tiefe = 0): Hold => {
  const poly: Vec2[] = Array.from({ length: 12 }, (_, i) => [((xcm + rcm * Math.cos((i / 12) * 2 * Math.PI)) / 300), (ycm + rcm * Math.sin((i / 12) * 2 * Math.PI)) / 240]);
  return makeHold(id, poly, 'auto', 0.001, { tiefe_cm: tiefe });
};
const probeAt = (kind: Probe['kind'], xcm: number, ycm: number, c = 0.9): Probe => ({ kind, x: cm(xcm), y: cm(ycm), c });
const obs = (limb: Limb, probes: Probe[], evidence: LimbObservation['evidence'] = 'hand-landmarks'): LimbObservation => ({ limb, probes, evidence });
const handObs = (x: number, y: number, c = 0.9): LimbObservation => obs('RH', [probeAt('palm', x, y, c), probeAt('tip', x, y - 3, c), probeAt('wrist', x, y + 9, c)]);

function run(m: ContactMatcher, frames: { t: number; o: LimbObservation[] }[]): { states: ContactState[]; events: ContactEvent[] } {
  const states: ContactState[] = [];
  const events: ContactEvent[] = [];
  for (const f of frames) { states.push(m.update(f.t, f.o)); events.push(...m.drainEvents()); }
  return { states, events };
}
const series = (t0: number, t1: number, dt: number, f: (t: number) => LimbObservation[]): { t: number; o: LimbObservation[] }[] => {
  const out = []; for (let t = t0; t <= t1; t += dt) out.push({ t, o: f(t) }); return out;
};
let seed = 1; const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };

describe('Kontaktlogik', () => {
  const holds = [hold(1, 100, 100, 5), hold(2, 200, 100, 5)];
  const mk = (extra = {}): ContactMatcher => new ContactMatcher(holds, ASPEKT, { cmPerUnit: CM, ...extra });
  // Hinweis: x_iso = u·aspekt; ein Griff bei xcm hat u = xcm/300, x_iso = xcm/300·1.25 = xcm/240 ✓ passend zu cm(x)=x/240

  it('Hand ruht auf Griff → Start-Ereignis, dann HOLDING, genau ein Event', () => {
    const m = mk();
    const { states, events } = run(m, series(0, 2000, 33, () => [handObs(100, 100)]));
    expect(events.filter((e) => e.typ === 'start').length).toBe(1);
    expect(events[0]!.holdId).toBe(1);
    expect(states.at(-1)!.limbs.RH.state).toBe('HOLDING');
    expect(states.at(-1)!.limbs.RH.holdId).toBe(1);
    expect(states.at(-1)!.aktiveGriffe).toEqual([1]);
    expect(events.length).toBe(1); // kein Flackern
  });
  it('Start wird auf den Beginn der Bedingung zurückdatiert (Dwell-Latenz)', () => {
    const { events } = run(mk(), series(1000, 2000, 33, () => [handObs(100, 100)]));
    expect(events[0]!.t).toBeLessThan(1000 + 100);
  });
  it('schnelles Überstreichen eines Griffs erzeugt KEINEN Kontakt', () => {
    const m = mk();
    const { events } = run(m, series(0, 600, 33, (t) => [handObs(50 + t * 0.2, 100)])); // 200 cm/s
    expect(events.length).toBe(0);
  });
  it('langsames Anfahren: Kontakt erst nach Verweildauer', () => {
    const m = mk();
    const { states } = run(m, series(0, 1500, 33, (t) => [handObs(Math.min(100, 70 + t * 0.03), 100)]));
    expect(states[0]!.limbs.RH.state).toBe('FREE');
    expect(states.at(-1)!.limbs.RH.holdId).toBe(1);
  });
  it('Rauschen σ≈1,5 cm im Stillstand: stabiler Kontakt, kein Flackern', () => {
    const m = mk();
    const { events, states } = run(m, series(0, 5000, 33, () => [handObs(100 + rnd() * 3, 100 + rnd() * 3)]));
    expect(events.filter((e) => e.typ === 'ende').length).toBe(0);
    expect(events.filter((e) => e.typ === 'start').length).toBe(1);
    expect(states.at(-1)!.limbs.RH.state).toBe('HOLDING');
  });
  it('Hysterese: leichtes Abdriften (knapp außerhalb Toleranz) beendet nicht sofort, deutliches Entfernen schon', () => {
    const m = mk();
    const frames = [...series(0, 1000, 33, () => [handObs(100, 100)]), ...series(1033, 1500, 33, () => [handObs(100, 100 + 7.5)]), ...series(1533, 3000, 33, () => [handObs(100, 140)])];
    const { events } = run(m, frames);
    const ende = events.find((e) => e.typ === 'ende');
    expect(ende).toBeDefined();
    expect(ende!.t).toBeGreaterThan(1500); // erst beim echten Entfernen
  });
  it('Verdeckung: Zustand wird gehalten (OCCLUDED_HOLD), Konfidenz sinkt, nach langer Lücke Ende', () => {
    const m = mk();
    const frames = [...series(0, 1000, 33, () => [handObs(100, 100)]), ...series(1033, 1300, 33, () => []), ...series(1333, 3500, 33, () => [])];
    const { states, events } = run(m, frames);
    const at = (t: number): ContactState => states.find((s) => s.t >= t)!;
    expect(at(1200).limbs.RH.state).toBe('OCCLUDED_HOLD');
    expect(at(1200).limbs.RH.evidence).toBe('geschaetzt');
    expect(at(1200).limbs.RH.holdId).toBe(1);
    const c1 = at(1500).limbs.RH.confidence, c2 = at(2200).limbs.RH.confidence;
    expect(c2).toBeLessThan(c1);
    expect(events.find((e) => e.typ === 'ende')).toBeDefined();
    expect(states.at(-1)!.limbs.RH.state).toBe('FREE');
  });
  it('kurze Verdeckung (300 ms) mit Rückkehr am selben Griff → kein Ende-Ereignis', () => {
    const m = mk();
    const frames = [...series(0, 1000, 33, () => [handObs(100, 100)]), ...series(1033, 1300, 33, () => []), ...series(1333, 2500, 33, () => [handObs(100, 100)])];
    const { events, states } = run(m, frames);
    expect(events.filter((e) => e.typ === 'ende').length).toBe(0);
    expect(states.at(-1)!.limbs.RH.state).toBe('HOLDING');
  });
  it('niedrige Konfidenz zählt wie Verdeckung', () => {
    const m = mk();
    const frames = [...series(0, 1000, 33, () => [handObs(100, 100)]), ...series(1033, 1250, 33, () => [handObs(100, 100, 0.1)])];
    const { states } = run(m, frames);
    expect(states.at(-1)!.limbs.RH.state).toBe('OCCLUDED_HOLD');
  });
  it('zwei Griffe 6 cm auseinander, Hand dazwischen → Mehrdeutigkeit', () => {
    const near = [hold(1, 100, 100, 4), hold(2, 112, 100, 4)];
    const m = new ContactMatcher(near, ASPEKT, { cmPerUnit: CM });
    const { states } = run(m, series(0, 1500, 33, () => [handObs(106, 100)]));
    const last = states.at(-1)!.limbs.RH;
    expect(last.ambiguous).toBe(true);
    expect(last.candidates.length).toBeGreaterThanOrEqual(2);
    expect(last.flags).toContain('mehrdeutig');
  });
  it('Griffwechsel: klare Bewegung zum zweiten Griff → wechsel/ende+start, nicht beides gleichzeitig aktiv', () => {
    const m = mk();
    const frames = [...series(0, 1000, 33, () => [handObs(100, 100)]), ...series(1033, 1300, 33, (t) => [handObs(100 + ((t - 1033) / 267) * 100, 100)]), ...series(1333, 2500, 33, () => [handObs(200, 100)])];
    const { events, states } = run(m, frames);
    expect(events.some((e) => e.holdId === 2 && (e.typ === 'wechsel' || e.typ === 'start'))).toBe(true);
    expect(states.at(-1)!.limbs.RH.holdId).toBe(2);
    expect(states.at(-1)!.aktiveGriffe).toEqual([2]);
  });
  it('unregelmäßige Frame-Abstände (Frame-Drops) ändern das Ergebnis nicht', () => {
    const frames = [0, 33, 150, 183, 400, 433, 700, 733, 1100, 1133, 1500].map((t) => ({ t, o: [handObs(100, 100)] }));
    const { events, states } = run(mk(), frames);
    expect(events.length).toBe(1);
    expect(states.at(-1)!.limbs.RH.holdId).toBe(1);
  });
  it('nur Pose (keine Hand-Landmarks): Konfidenz gedeckelt auf 0,7', () => {
    const m = mk();
    const { states } = run(m, series(0, 1500, 33, () => [obs('RH', [probeAt('wrist', 100, 100)], 'nur-pose')]));
    const s = states.at(-1)!.limbs.RH;
    expect(s.confidence).toBeLessThanOrEqual(0.7 + 1e-9);
  });
  it('Handgelenk allein 9 cm unter dem Griff (typisch bei Leisten): Handgelenk-Toleranz ×2 reicht nicht → kein Kontakt; mit Fingerspitze am Griff → Kontakt', () => {
    const only = run(mk(), series(0, 1500, 33, () => [obs('RH', [probeAt('wrist', 100, 118)])])).states.at(-1)!;
    expect(only.limbs.RH.holdId).toBeNull();
    const withTip = run(mk(), series(0, 1500, 33, () => [obs('RH', [probeAt('wrist', 100, 112), probeAt('tip', 100, 101)])])).states.at(-1)!;
    expect(withTip.limbs.RH.holdId).toBe(1);
  });
  it('Fuß: Ferse (Heel Hook) am Griff genügt, Knöchel-Probe hat geringes Gewicht', () => {
    const m = mk();
    const { states } = run(m, series(0, 1500, 33, () => [obs('LF', [probeAt('heel', 100, 100), probeAt('ankle', 100, 115), probeAt('toe', 100, 130)], 'gesehen')]));
    expect(states.at(-1)!.limbs.LF.holdId).toBe(1);
  });
  it('mehrere Gliedmaßen am selben Griff sind erlaubt und unabhängig', () => {
    const m = mk();
    const { states } = run(m, series(0, 1500, 33, () => [handObs(100, 100), obs('LH', [probeAt('palm', 100, 101), probeAt('tip', 100, 98)])]));
    const s = states.at(-1)!;
    expect(s.limbs.RH.holdId).toBe(1);
    expect(s.limbs.LH.holdId).toBe(1);
    expect(s.aktiveGriffe).toEqual([1]);
  });
  it('Tiefe des Griffs vergrößert die Toleranz (Parallaxe)', () => {
    const flat = [hold(1, 100, 100, 5, 0)], deep = [hold(1, 100, 100, 5, 20)];
    const probe = (): LimbObservation[] => [obs('RH', [probeAt('palm', 100, 111), probeAt('tip', 100, 110)])]; // 5–6 cm vom Rand
    const a = run(new ContactMatcher(flat, ASPEKT, { cmPerUnit: CM }), series(0, 1500, 33, probe)).states.at(-1)!.limbs.RH.confidence;
    const b = run(new ContactMatcher(deep, ASPEKT, { cmPerUnit: CM }), series(0, 1500, 33, probe)).states.at(-1)!.limbs.RH.confidence;
    expect(b).toBeGreaterThan(a);
  });
  it('Sprung-Ausreißer (Teleport) senkt die Plausibilität statt Kontakt zu erzeugen', () => {
    const m = mk();
    const frames = [...series(0, 600, 33, () => [handObs(10, 10)]), ...series(633, 700, 33, () => [handObs(100, 100)])];
    const { states } = run(m, frames);
    const atJump = states.find((x) => x.t >= 633)!;
    expect(atJump.limbs.RH.flags).toContain('sprung');
    expect(atJump.limbs.RH.holdId).toBeNull();
  });
  it('deterministisch: gleiche Eingabe → gleiche Ausgabe', () => {
    const f = series(0, 2000, 33, (t) => [handObs(100 + Math.sin(t / 300) * 2, 100)]);
    const a = run(mk(), f), b = run(mk(), f);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
  it('Performance: 400 Griffe × 4 Gliedmaßen < 2 ms/Frame (Mittel)', () => {
    const many: Hold[] = []; for (let r = 0; r < 20; r++) for (let c = 0; c < 20; c++) many.push(hold(r * 20 + c + 1, 10 + c * 14, 10 + r * 11, 4));
    const m = new ContactMatcher(many, ASPEKT, { cmPerUnit: CM });
    const o = (t: number): LimbObservation[] => (['LH', 'RH', 'LF', 'RF'] as Limb[]).map((l, i) => obs(l, [probeAt('palm', 100 + i * 40 + Math.sin(t / 200) * 3, 100 + i * 20), probeAt('wrist', 100 + i * 40, 109 + i * 20)]));
    const t0 = performance.now();
    for (let t = 0; t < 3000; t += 33) m.update(t, o(t));
    const per = (performance.now() - t0) / (3000 / 33);
    expect(per).toBeLessThan(2);
  });
});
