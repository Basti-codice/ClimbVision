/** Browser-Bild-I/O (Canvas). Nur im Browser verwendbar. */
import type { Rgba } from '../image/raster';

export async function bitmapToRgba(b: ImageBitmap, maxW?: number): Promise<Rgba> {
  const k = maxW ? Math.min(1, maxW / b.width) : 1;
  const w = Math.round(b.width * k), h = Math.round(b.height * k);
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  g.drawImage(b, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}
export async function fileToRgba(f: Blob, maxW = 2400): Promise<Rgba> { const b = await createImageBitmap(f); const r = await bitmapToRgba(b, maxW); b.close(); return r; }
export async function rgbaToBlob(img: Rgba, mime = 'image/jpeg', quality = 0.9): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
  g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.convertToBlob({ type: mime, quality });
}
export async function blobToBytes(b: Blob): Promise<Uint8Array> { return new Uint8Array(await b.arrayBuffer()); }
export function rgbaToImageBitmap(img: Rgba): Promise<ImageBitmap> { return createImageBitmap(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height)); }

/** Pixelweiser Median über mehrere Frames (entfernt vorbeilaufende Personen/Rauschen). */
export function medianFrames(frames: readonly Rgba[]): Rgba {
  const first = frames[0]; if (!first) throw new Error('Keine Frames');
  const { width, height } = first; const out = new Uint8ClampedArray(width * height * 4);
  const n = frames.length, buf = new Uint8Array(n);
  for (let i = 0; i < out.length; i++) {
    if ((i & 3) === 3) { out[i] = 255; continue; }
    for (let f = 0; f < n; f++) buf[f] = (frames[f] as Rgba).data[i] as number;
    buf.sort(); out[i] = buf[n >> 1] as number;
  }
  return { width, height, data: out };
}
