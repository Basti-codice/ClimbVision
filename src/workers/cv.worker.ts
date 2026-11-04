/// <reference lib="webworker" />
/** CV-Worker (ES-Modul): Griff-Segmentierung und Registrierung – rechenintensiv, daher nicht im UI-Thread. */
import { segmentHolds, type SegmentOptions } from '../holds/segment';
import { alignHomography, cornerShift, holdContrast } from '../registration/align';
import { assessRegistration } from '../registration/assess';
import { toGray, type Rgba } from '../image/raster';
import type { Vec2, Mat3 } from '../geometry/homography';

export type CvRequest =
  | { type: 'segment'; id: number; image: Rgba; options?: Partial<Omit<SegmentOptions, 'onProgress'>> }
  | { type: 'register'; id: number; ref: Rgba; neu: Rgba; polygons: Vec2[][]; aspekt: number };
export type CvResponse =
  | { type: 'progress'; id: number; fraction: number; schritt: string }
  | { type: 'segmented'; id: number; polygons: Vec2[][]; ms: number; polaritaet: 'hell' | 'dunkel' }
  | { type: 'registered'; id: number; hRes: Mat3; quality: ReturnType<typeof assessRegistration>; ms: number }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
ctx.onmessage = (e: MessageEvent<CvRequest>) => {
  const m = e.data;
  const post = (r: CvResponse): void => ctx.postMessage(r);
  try {
    const t0 = performance.now();
    if (m.type === 'segment') {
      const r = segmentHolds(m.image, { ...m.options, onProgress: (fraction, schritt) => post({ type: 'progress', id: m.id, fraction, schritt }) });
      post({ type: 'segmented', id: m.id, polygons: r.polygons, ms: performance.now() - t0, polaritaet: r.polaritaet });
    } else if (m.type === 'register') {
      const ref = toGray(m.ref), neu = toGray(m.neu);
      const r = alignHomography(ref, neu);
      const q = assessRegistration({ ncc: r.ncc, nccVorher: r.nccVorher, eckverschiebung: cornerShift(r.hRes, m.aspekt), quadrantNcc: r.quadrantNcc, griffKontrastNeu: holdContrast(neu, m.polygons), griffKontrastRef: holdContrast(ref, m.polygons), konvergiert: r.konvergiert });
      post({ type: 'registered', id: m.id, hRes: r.hRes, quality: q, ms: performance.now() - t0 });
    }
  } catch (err) { post({ type: 'error', id: m.id, message: String((err as Error).message ?? err) }); }
};
