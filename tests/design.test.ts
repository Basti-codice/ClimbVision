import { describe, expect, it } from 'vitest';
import { limbColor, color } from '../src/design/tokens';
import { contrast, deltaE, hexToRgb, simulate, type Cvd } from '../src/design/color';
import { LIMBS } from '../src/core/schemas';
import { getLang, setLang, t, availableKeys } from '../src/i18n';
import fs from 'node:fs';

describe('Design-Tokens', () => {
  const bg = hexToRgb(color.bg);
  it('Limb-Farben: Kontrast gegen dunklen Hintergrund ≥ 4,5:1 (WCAG AA)', () => {
    for (const l of LIMBS) expect(contrast(hexToRgb(limbColor[l]), bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('Limb-Farben bleiben unter Protanopie/Deuteranopie/Tritanopie paarweise unterscheidbar (ΔE ≥ 15)', () => {
    for (const cvd of ['protanopie', 'deuteranopie', 'tritanopie'] as Cvd[])
      for (let i = 0; i < LIMBS.length; i++) for (let j = i + 1; j < LIMBS.length; j++) {
        const a = simulate(hexToRgb(limbColor[LIMBS[i]!]), cvd), b = simulate(hexToRgb(limbColor[LIMBS[j]!]), cvd);
        expect(deltaE(a, b), `${LIMBS[i]} vs ${LIMBS[j]} (${cvd})`).toBeGreaterThanOrEqual(15);
      }
  });
  it('Textkontrast ≥ 7:1 (AAA) auf Hintergrund und Flächen', () => {
    expect(contrast(hexToRgb(color.text), bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(hexToRgb(color.textMuted), hexToRgb(color.surface))).toBeGreaterThanOrEqual(7);
  });
  it('CSS-Tokens und TS-Tokens sind synchron (Limb-Farben)', () => {
    const css = fs.readFileSync('src/design/base.css', 'utf8');
    for (const l of LIMBS) expect(css).toContain(`--limb-${l}: ${limbColor[l]}`);
    expect(css).toContain(`--c-bg: ${color.bg}`);
  });
});

describe('i18n', () => {
  it('Fallback auf Deutsch, Variablen, unbekannter Schlüssel', () => {
    setLang('en'); expect(t('btn.lock')).toBe('Lock person'); expect(t('limb.LH')).toBe('Linke Hand'); setLang('de');
    expect(getLang()).toBe('de');
    expect(t('gibt.es.nicht')).toBe('gibt.es.nicht');
    expect(availableKeys().length).toBeGreaterThan(20);
  });
});
