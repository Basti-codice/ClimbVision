/** Farbmathematik: WCAG-Kontrast, Lab/ΔE und Farbfehlsichtigkeits-Simulation (Machado 2009, Schweregrad 1.0). */
export type RGB = [number, number, number];
export const hexToRgb = (h: string): RGB => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const unlin = (v: number): number => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));

export function luminance(c: RGB): number { return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]); }
export function contrast(a: RGB, b: RGB): number { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }

export type Cvd = 'protanopie' | 'deuteranopie' | 'tritanopie';
const M: Record<Cvd, number[]> = {
  protanopie: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopie: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopie: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};
export function simulate(c: RGB, t: Cvd): RGB {
  const l = [lin(c[0]), lin(c[1]), lin(c[2])], m = M[t];
  return [unlin((m[0] as number) * (l[0] as number) + (m[1] as number) * (l[1] as number) + (m[2] as number) * (l[2] as number)), unlin((m[3] as number) * (l[0] as number) + (m[4] as number) * (l[1] as number) + (m[5] as number) * (l[2] as number)), unlin((m[6] as number) * (l[0] as number) + (m[7] as number) * (l[1] as number) + (m[8] as number) * (l[2] as number))];
}
export function lab(c: RGB): [number, number, number] {
  const r = lin(c[0]), g = lin(c[1]), b = lin(c[2]);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, y = 0.2126 * r + 0.7152 * g + 0.0722 * b, z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
export const deltaE = (a: RGB, b: RGB): number => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
