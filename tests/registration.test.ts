import { describe, expect, it } from 'vitest';
import { syntheticWall } from './helpers';
import { toGray, warpGrayBy, newGray, type Gray } from '../src/image/raster';
import { alignHomography, cornerShift, holdContrast } from '../src/registration/align';
import { assessRegistration } from '../src/registration/assess';
import { measureDrift, selectAnchors } from '../src/registration/drift';
import { applyH, inv3, type Mat3, type Vec2 } from '../src/geometry/homography';
import { segmentHolds } from '../src/holds/segment';

const W = 720, H = 460;
const ref = syntheticWall(W, H, { texture: true });
const refGray = toGray(ref.img);

/** moved(y) = ref(Wtrue⁻¹(y)) in normalisierten Koordinaten. */
const moveBy = (g: Gray, wTrue: Mat3, gain = 1, offset = 0): Gray => {
  const inv = inv3(wTrue);
  const out = warpGrayBy(g, (x, y) => { const p = applyH(inv, [(x + 0.5) / g.width, (y + 0.5) / g.height]); return [p[0] * g.width - 0.5, p[1] * g.height - 0.5]; });
  for (let i = 0; i < out.data.length; i++) out.data[i] = Math.max(0, Math.min(255, (out.data[i] as number) * gain + offset));
  return out;
};
const maxErr = (a: Mat3, b: Mat3): number => Math.max(...([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]] as Vec2[]).map((c) => { const p = applyH(a, c), q = applyH(b, c); return Math.hypot(p[0] - q[0], p[1] - q[1]); }));

describe('Registrierung (Lucas–Kanade)', () => {
  const rot = 0.01, cs = Math.cos(rot), sn = Math.sin(rot);
  const wTrue: Mat3 = [1.012 * cs, -sn, 0.012, sn, 1.012 * cs, -0.009, 0.004, -0.003, 1];
  it('Identität: findet keine Verschiebung', () => {
    const r = alignHomography(refGray, refGray);
    expect(maxErr(r.hRes, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeLessThan(0.0015);
    expect(r.ncc).toBeGreaterThan(0.95);
  });
  it('bekannte Verschiebung + Rotation + Skalierung + Perspektive wird auf < 0,3 % korrigiert', () => {
    const moved = moveBy(refGray, wTrue);
    const r = alignHomography(refGray, moved);
    expect(maxErr(r.hRes, wTrue)).toBeLessThan(0.003);
    expect(r.ncc).toBeGreaterThan(r.nccVorher);
    expect(r.konvergiert || r.ncc > 0.8).toBe(true);
  });
  it('robust gegen Helligkeits-/Kontraständerung', () => {
    const moved = moveBy(refGray, wTrue, 0.7, 25);
    const r = alignHomography(refGray, moved);
    expect(maxErr(r.hRes, wTrue)).toBeLessThan(0.004);
  });
  it('Ampel: korrekt ausgerichtet → grün; andere Wand → rot', () => {
    const moved = moveBy(refGray, wTrue);
    const r = alignHomography(refGray, moved);
    const polys = segmentHolds(ref.img).polygons;
    const cRef = holdContrast(refGray, polys);
    // Griffe liegen nach Korrektur wieder auf den Kanten des neuen Bildes → Kontrast im neuen Bild entlang der korrigierten Polygone
    const hInv = inv3(r.hRes);
    const polysNew = polys.map((p) => p.map((q) => applyH(hInv, q)).map((q) => applyH(wTrue, q)));
    const cNew = holdContrast(moved, polysNew);
    const good = assessRegistration({ ncc: r.ncc, nccVorher: r.nccVorher, eckverschiebung: cornerShift(r.hRes, W / H), quadrantNcc: r.quadrantNcc, griffKontrastNeu: cNew, griffKontrastRef: cRef, konvergiert: r.konvergiert });
    expect(good.ampel).toBe('gruen');

    // wirklich andere Wand: zufällig verteilte Rechtecke (kein Raster)
    const other = newGray(W, H); other.data.fill(35);
    let sd = 5; const rr = (): number => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let k = 0; k < 40; k++) { const x0 = Math.floor(rr() * (W - 60)), y0 = Math.floor(rr() * (H - 50)), ww = 20 + Math.floor(rr() * 40), hh = 15 + Math.floor(rr() * 35); for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) other.data[y * W + x] = 150 + rr() * 60; }
    const bad = alignHomography(refGray, other);
    const badQ = assessRegistration({ ncc: bad.ncc, nccVorher: bad.nccVorher, eckverschiebung: cornerShift(bad.hRes, W / H), quadrantNcc: bad.quadrantNcc, griffKontrastNeu: holdContrast(other, polys), griffKontrastRef: cRef, konvergiert: bad.konvergiert });
    expect(badQ.ampel).toBe('rot');
    expect(badQ.hinweise.length).toBeGreaterThan(0);
  });
  it('zu große Verschiebung (10 %) wird nicht als grün durchgewunken', () => {
    const moved = moveBy(refGray, [1, 0, 0.1, 0, 1, 0.08, 0, 0, 1]);
    const r = alignHomography(refGray, moved);
    const q = assessRegistration({ ncc: r.ncc, nccVorher: r.nccVorher, eckverschiebung: cornerShift(r.hRes, W / H), quadrantNcc: r.quadrantNcc, griffKontrastNeu: 0.3, griffKontrastRef: 0.3, konvergiert: r.konvergiert });
    expect(q.ampel === 'gruen' && maxErr(r.hRes, [1, 0, 0.1, 0, 1, 0.08, 0, 0, 1]) > 0.01).toBe(false);
  });
  it('Quadrant-NCC bei lokaler Veränderung: ein Viertel verändert → ≥ 3 Quadranten bleiben gut', () => {
    const changed = toGray(ref.img);
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) changed.data[y * W + x] = ((x * 7 + y * 13) % 255);
    const r = alignHomography(refGray, changed);
    expect(r.quadrantNcc.filter((q) => q > 0.5).length).toBeGreaterThanOrEqual(3);
  });
});

describe('Drift-Monitor (Anker)', () => {
  const holds = segmentHolds(ref.img).polygons;
  const anchors = selectAnchors(refGray, holds);
  const shift = (dxPx: number, dyPx: number): Gray => warpGrayBy(refGray, (x, y) => [x - dxPx, y - dyPx]);
  it('wählt verteilte Anker außerhalb von Griffen', () => {
    expect(anchors.length).toBeGreaterThanOrEqual(8);
    for (const a of anchors) expect(a.u > 0 && a.u < 1 && a.v > 0 && a.v < 1).toBe(true);
    expect(new Set(anchors.map((a) => `${Math.floor(a.u * 4)}-${Math.floor(a.v * 4)}`)).size).toBe(anchors.length);
  });
  it('keine Bewegung → ok', () => {
    const m = measureDrift(anchors, refGray);
    expect(m.status).toBe('ok');
    expect(m.betrag).toBeLessThan(0.0015);
    expect(m.gueltig).toBeGreaterThan(0.9);
  });
  it('misst kleine Verschiebung (5 px bei 720 px Breite = 0,7 %) auf ~0,2 % genau und warnt', () => {
    const m = measureDrift(anchors, shift(5, 0), { workWidth: 720 });
    expect(Math.abs(m.dx - 5 / 720)).toBeLessThan(0.002);
    expect(m.status).toBe('warnung');
  });
  it('3 px (0,4 %) liegt unter der Warnschwelle → ok', () => {
    expect(measureDrift(anchors, shift(3, 0), { workWidth: 720 }).status).toBe('ok');
  });
  it('große Verschiebung → verloren', () => {
    const m = measureDrift(anchors, shift(14, 8), { workWidth: 720, searchPx: 12 });
    expect(m.status === 'verloren' || m.betrag > 0.015).toBe(true);
  });
  it('Personenmaske schließt verdeckte Anker aus; zu wenig sichtbar → verloren', () => {
    const all = measureDrift(anchors, refGray, { maskBoxes: [[0, 0, 1, 1]] });
    expect(all.sichtbar).toBe(0);
    expect(all.status).toBe('verloren');
    const some = measureDrift(anchors, refGray, { maskBoxes: [[0, 0, 0.3, 1]] });
    expect(some.sichtbar).toBeLessThan(1);
  });
  it('leeres/gleichförmiges Bild liefert keine gültigen Anker-Treffer', () => {
    const flat = newGray(W, H); flat.data.fill(100);
    expect(measureDrift(anchors, flat).status).toBe('verloren');
  });
});
