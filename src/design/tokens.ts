/** Design-Tokens (TS-Spiegel von tokens.css – für Canvas-Rendering). Einzige Quelle für Limb-Farben. */
import type { Limb } from '../core/schemas';

export const color = {
  bg: '#0b0d10', surface: '#12161b', surface2: '#1a2027', border: '#2a323c', text: '#f2f5f8', textMuted: '#a9b4c0',
  accent: '#7cc4ff', ok: '#3ddc97', warn: '#ffc857', error: '#ff6b6b', uncertain: '#c3a6ff',
  holdFill: 'rgba(255,255,255,0.07)', holdStroke: '#8d99a6', holdStrokeActive: '#ffffff',
} as const;

/** Okabe–Ito-basiert; redundant codiert durch Form (Hände Kreis, Füße Quadrat) und Buchstabe. */
export const limbColor: Record<Limb, string> = { LH: '#56b4e9', RH: '#e69f00', LF: '#009e73', RF: '#cc79a7' };
export const limbLabel: Record<Limb, string> = { LH: 'LH', RH: 'RH', LF: 'LF', RF: 'RF' };
export const limbShape: Record<Limb, 'kreis' | 'quadrat'> = { LH: 'kreis', RH: 'kreis', LF: 'quadrat', RF: 'quadrat' };
/** Feste Quadranten um den Griffschwerpunkt: Mehrfachbelegung bleibt lesbar. */
export const limbQuadrant: Record<Limb, { sx: number; sy: number }> = { LH: { sx: -1, sy: -1 }, RH: { sx: 1, sy: -1 }, LF: { sx: -1, sy: 1 }, RF: { sx: 1, sy: 1 } };

export const css = (): string => `:root{${Object.entries(color).map(([k, v]) => `--c-${k}:${v}`).join(';')};${Object.entries(limbColor).map(([k, v]) => `--limb-${k}:${v}`).join(';')}}`;
