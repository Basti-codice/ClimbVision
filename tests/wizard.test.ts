import { describe, expect, it } from 'vitest';
import { createProfile, estimateAspect, normalizedHomography, rectSize, rectify, refinedHomography, resolveAspect, verdict } from '../src/app/wizard';
import { applyH, inv3, mul3, type Mat3, type Vec2 } from '../src/geometry/homography';
import type { Rgba } from '../src/image/raster';
import { snapshotOf } from '../src/app/esp32';
import { ContactMatcher } from '../src/contact/matcher';
import { makeHold } from '../src/holds/editor';

// Testbild in normierten Koordinaten definiert → skalierungsinvariant
const synth = (w: number, h: number): Rgba => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; const v = (Math.floor((x / w) * 12) + Math.floor((y / h) * 9)) % 2 ? 220 : 40; d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; } return { width: w, height: h, data: d }; };

describe('Wizard', () => {
  it('Seitenverhältnis: Schätzung, Maße haben Vorrang, manuell vor Schätzung', () => {
    expect(estimateAspect([[0, 0], [100, 0], [100, 80], [0, 80]])).toBeCloseTo(1.25, 9);
    expect(resolveAspect({ breite_cm: 300, hoehe_cm: 240, manuell: 2, geschaetzt: 1 })).toBeCloseTo(1.25, 9);
    expect(resolveAspect({ manuell: 0.8, geschaetzt: 1 })).toBe(0.8);
    expect(resolveAspect({ geschaetzt: 0.9 })).toBe(0.9);
    expect(rectSize(1.25)).toEqual({ w: 1600, h: 1280 });
    expect(rectSize(0.5)).toEqual({ w: 800, h: 1600 });
  });
  it('Profil: Homographie auf normalisierten Koordinaten, Ecken → Einheitsquadrat, Entzerrung hat Zielgröße', () => {
    const img = synth(400, 300);
    const corners: Vec2[] = [[40, 30], [360, 20], [380, 280], [20, 270]];
    const { profile, rect } = createProfile({ id: 'w', name: 'Test', winkel_grad: 0, aspekt: 1.25, image: img, cornersPx: corners, fotoBlobId: 'a', rectBlobId: 'b', now: 'x' });
    const h = profile.homographie as unknown as Mat3;
    const tl = applyH(h, [40 / 400, 30 / 300]); expect(tl[0]).toBeCloseTo(0, 9); expect(tl[1]).toBeCloseTo(0, 9);
    const br = applyH(h, [380 / 400, 280 / 300]); expect(br[0]).toBeCloseTo(1, 9); expect(br[1]).toBeCloseTo(1, 9);
    expect(rect.width).toBe(1600); expect(rect.height).toBe(1280);
    expect(profile.referenz_entzerrt.breite_px).toBe(1600);
  });
  it('Ungültige Ecken geben deutsche Fehlermeldungen', () => {
    const img = synth(400, 300);
    const mk = (c: Vec2[]) => () => createProfile({ id: 'w', name: 'T', winkel_grad: 0, aspekt: 1, image: img, cornersPx: c, fotoBlobId: 'a', rectBlobId: 'b', now: 'x' });
    expect(mk([[0, 0], [10, 10], [10, 0], [0, 10]])).toThrow(/Viereck/);
    expect(mk([[10, 10], [20, 10], [20, 20], [10, 20]])).toThrow(/zu klein/);
    expect(mk([[50, 50], [50, 250], [350, 250], [350, 50]])).toThrow(/Reihenfolge/);
  });
  it('Auflösungsunabhängig: gleiche Entzerrung aus 400×300 und 800×600 (gleiche normierte Ecken)', () => {
    const a = synth(400, 300), b = synth(800, 600);
    const hA = normalizedHomography([[40, 30], [360, 20], [380, 280], [20, 270]], 400, 300);
    const hB = normalizedHomography([[80, 60], [720, 40], [760, 560], [40, 540]], 800, 600);
    for (let i = 0; i < 9; i++) expect(hA[i]).toBeCloseTo(hB[i] as number, 9);
    const ra = rectify(a, hA, 1, 200), rb = rectify(b, hB, 1, 200);
    let diff = 0; for (let i = 0; i < ra.data.length; i += 4) diff += Math.abs((ra.data[i] as number) - (rb.data[i] as number));
    expect(diff / (ra.data.length / 4)).toBeLessThan(25); // Schachbrett-Kanten leicht unterschiedlich abgetastet
  });
  it('Verfeinerte Homographie: H = hRes⁻¹ ∘ H0 hebt eine bekannte Rest-Verschiebung exakt auf', () => {
    const h0: Mat3 = normalizedHomography([[40, 30], [360, 20], [380, 280], [20, 270]], 400, 300);
    const hRes: Mat3 = [1.01, 0.005, 0.01, -0.004, 0.99, -0.008, 0, 0, 1];
    const refined = refinedHomography(h0, hRes);
    const p: Vec2 = [0.4, 0.5];
    const y0 = applyH(h0, p), x = applyH(inv3(hRes), y0), r = applyH(refined, p);
    expect(r[0]).toBeCloseTo(x[0], 9); expect(r[1]).toBeCloseTo(x[1], 9);
    const back = mul3(refined, inv3(h0)); // = hRes⁻¹
    const q = applyH(back, [0.3, 0.3]), e = applyH(inv3(hRes), [0.3, 0.3]);
    expect(q[0]).toBeCloseTo(e[0], 9);
  });
  it('Urteil: grün frei, gelb mit Warnung, rot gesperrt', () => {
    const q = (ampel: 'gruen' | 'gelb' | 'rot') => ({ ampel, ncc: 0, eckverschiebung: 0, quadrantenOk: 0, griffKontrast: 0, hinweise: ['x'] });
    expect(verdict(q('gruen'))).toMatchObject({ freigabe: true, warnung: false });
    expect(verdict(q('gelb'))).toMatchObject({ freigabe: true, warnung: true });
    expect(verdict(q('rot'))).toMatchObject({ freigabe: false });
    expect(verdict(q('rot')).text).toMatch(/neu/);
  });
});

describe('ESP32-Snapshot', () => {
  it('nur aktive Kontakte (inkl. verdeckt-gehalten) werden gesendet', () => {
    const m = new ContactMatcher([makeHold(1, [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]], 'auto', 0.01)], 1.25);
    const cs = m.update(0, []);
    const s = snapshotOf(cs);
    expect(s.LH.holdId).toBeNull(); expect(s.RF.confidence).toBe(0);
  });
});
