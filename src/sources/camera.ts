import { describeMediaError, mountHidden, unmountHidden, type Frame, type FrameSource, type SourceInfo } from './types';

export interface CameraDevice { deviceId: string; label: string }
export interface CameraOptions { deviceId?: string | undefined; width?: number | undefined; height?: number | undefined; fps?: number | undefined; maxFrameWidth?: number | undefined }

/** Listet Kameras. Labels sind erst nach erteilter Berechtigung gefüllt. */
export async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}

/** Videoquelle über getUserMedia. Frames per requestVideoFrameCallback (Fallback: rAF). */
export class CameraSource implements FrameSource {
  element: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private cbs = new Set<(f: Frame) => void>();
  private running = false;
  private idx = 0;
  private infoV: SourceInfo = { kind: 'kamera', label: '', width: 0, height: 0, fps: null, tatsaechlich: false };
  constructor(private readonly opt: CameraOptions = {}) {}

  async start(): Promise<void> {
    if (!window.isSecureContext) throw describeMediaError({ name: 'SecurityError' });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { ...(this.opt.deviceId ? { deviceId: { exact: this.opt.deviceId } } : {}), ...(this.opt.width ? { width: { ideal: this.opt.width } } : {}), ...(this.opt.height ? { height: { ideal: this.opt.height } } : {}), ...(this.opt.fps ? { frameRate: { ideal: this.opt.fps } } : {}) },
      });
    } catch (e) { throw describeMediaError(e); }
    const track = this.stream.getVideoTracks()[0];
    const s = track?.getSettings() ?? {};
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = this.stream; mountHidden(v);
    await v.play();
    this.element = v;
    this.infoV = { kind: 'kamera', label: track?.label ?? 'Kamera', width: s.width ?? v.videoWidth, height: s.height ?? v.videoHeight, fps: s.frameRate ?? null, tatsaechlich: true };
    this.running = true; this.loop();
  }
  private loop(): void {
    const v = this.element; if (!v) return;
    const step = async (_now: number, meta?: VideoFrameCallbackMetadata): Promise<void> => {
      if (!this.running) return;
      if (this.cbs.size) {
        const w = this.opt.maxFrameWidth ?? 960, k = Math.min(1, w / v.videoWidth);
        const bmp = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * k), resizeHeight: Math.round(v.videoHeight * k), resizeQuality: 'low' });
        const t = meta?.captureTime ?? meta?.expectedDisplayTime ?? performance.now();
        const f: Frame = { bitmap: bmp, captureTime: t, frameIndex: this.idx++, width: bmp.width, height: bmp.height };
        for (const c of this.cbs) c(f);
      }
      this.next(step);
    };
    this.next(step);
  }
  private next(f: (n: number, m?: VideoFrameCallbackMetadata) => void): void {
    const v = this.element;
    if (v && 'requestVideoFrameCallback' in v) v.requestVideoFrameCallback((n, m) => f(n, m)); else requestAnimationFrame((n) => f(n));
  }
  onFrame(cb: (f: Frame) => void): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  info(): SourceInfo { return this.infoV; }
  stop(): void { this.running = false; this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; if (this.element) { this.element.srcObject = null; unmountHidden(this.element); } }
}
