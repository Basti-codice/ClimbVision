/** One-Euro-Filter (Casiez et al. 2012) mit echter Zeitbasis (ms). Reiner Zustandsautomat, deterministisch. */
export interface OneEuroParams { minCutoff: number; beta: number; dCutoff: number }
export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.5, beta: 0.05, dCutoff: 1.0 };

const alpha = (cutoffHz: number, dtS: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
};

export class OneEuro1D {
  private x: number | null = null;
  private dx = 0;
  private tPrev = 0;
  constructor(private p: OneEuroParams = DEFAULT_ONE_EURO) {}
  reset(): void { this.x = null; this.dx = 0; }
  setParams(p: OneEuroParams): void { this.p = p; }
  filter(v: number, tMs: number): number {
    if (this.x === null) { this.x = v; this.tPrev = tMs; this.dx = 0; return v; }
    const dt = Math.max(1e-3, (tMs - this.tPrev) / 1000);
    this.tPrev = tMs;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
  get velocity(): number { return this.dx; }
}

export class OneEuro2D {
  private fx: OneEuro1D;
  private fy: OneEuro1D;
  constructor(p: OneEuroParams = DEFAULT_ONE_EURO) { this.fx = new OneEuro1D(p); this.fy = new OneEuro1D(p); }
  reset(): void { this.fx.reset(); this.fy.reset(); }
  setParams(p: OneEuroParams): void { this.fx.setParams(p); this.fy.setParams(p); }
  filter(x: number, y: number, tMs: number): [number, number] { return [this.fx.filter(x, tMs), this.fy.filter(y, tMs)]; }
  /** Geschwindigkeit in Einheiten/s. */
  speed(): number { return Math.hypot(this.fx.velocity, this.fy.velocity); }
}
