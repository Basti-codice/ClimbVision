/** Promise-Fassade über den CV-Worker (Segmentierung, Registrierung). */
import type { CvRequest, CvResponse } from '../workers/cv.worker';
import type { Rgba } from '../image/raster';
import type { SegmentOptions } from '../holds/segment';
import type { Vec2, Mat3 } from '../geometry/homography';
import type { RegistrierungsQualitaet } from '../core/schemas';

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class CvClient {
  private w: Worker | null = null;
  private id = 0;
  private pending = new Map<number, { resolve: (r: CvResponse) => void; reject: (e: Error) => void; progress?: (f: number, s: string) => void }>();
  private worker(): Worker {
    if (!this.w) {
      this.w = new Worker(new URL('../workers/cv.worker.ts', import.meta.url), { type: 'module' });
      this.w.onmessage = (e: MessageEvent<CvResponse>) => {
        const p = this.pending.get(e.data.id); if (!p) return;
        if (e.data.type === 'progress') { p.progress?.(e.data.fraction, e.data.schritt); return; }
        this.pending.delete(e.data.id);
        if (e.data.type === 'error') p.reject(new Error(e.data.message)); else p.resolve(e.data);
      };
      this.w.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(e.message)); this.pending.clear(); };
    }
    return this.w;
  }
  private call(req: DistOmit<CvRequest, 'id'>, progress?: (f: number, s: string) => void): { promise: Promise<CvResponse>; cancel: () => void } {
    const id = ++this.id; const w = this.worker();
    const promise = new Promise<CvResponse>((resolve, reject) => { this.pending.set(id, { resolve, reject, ...(progress ? { progress } : {}) }); w.postMessage({ ...req, id }); });
    return { promise, cancel: () => { this.pending.delete(id); this.w?.terminate(); this.w = null; } };
  }
  segment(image: Rgba, options: Partial<Omit<SegmentOptions, 'onProgress'>>, progress: (f: number, s: string) => void): { promise: Promise<{ polygons: Vec2[][]; ms: number; polaritaet: 'hell' | 'dunkel' }>; cancel: () => void } {
    const c = this.call({ type: 'segment', image, options }, progress);
    return { cancel: c.cancel, promise: c.promise.then((r) => { if (r.type !== 'segmented') throw new Error('Unerwartete Antwort'); return { polygons: r.polygons, ms: r.ms, polaritaet: r.polaritaet }; }) };
  }
  async register(ref: Rgba, neu: Rgba, polygons: Vec2[][], aspekt: number): Promise<{ hRes: Mat3; quality: RegistrierungsQualitaet; ms: number }> {
    const r = await this.call({ type: 'register', ref, neu, polygons, aspekt }).promise;
    if (r.type !== 'registered') throw new Error('Unerwartete Antwort');
    return { hRes: r.hRes, quality: r.quality, ms: r.ms };
  }
  dispose(): void { this.w?.terminate(); this.w = null; }
}
