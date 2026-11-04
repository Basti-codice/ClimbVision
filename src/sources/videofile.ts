import type { Frame, FrameSource, SourceInfo } from './types';
import { SourceError } from './types';

export interface VideoFileOptions { loop?: boolean; playbackRate?: number; maxFrameWidth?: number }

/** Videodatei als Quelle (Entwicklung/Tests). Echtzeit-Wiedergabe mit rVFC; `stepTo` für deterministisches Einzelbild-Stepping. */
export class VideoFileSource implements FrameSource {
  readonly element: HTMLVideoElement;
  private url: string;
  private cbs = new Set<(f: Frame) => void>();
  private running = false;
  private idx = 0;
  private infoV: SourceInfo;
  constructor(private readonly file: File | Blob, private readonly opt: VideoFileOptions = {}) {
    this.url = URL.createObjectURL(file);
    this.element = document.createElement('video');
    this.element.muted = true; this.element.playsInline = true; this.element.loop = opt.loop ?? true; this.element.src = this.url;
    this.infoV = { kind: 'datei', label: (file as File).name ?? 'Videodatei', width: 0, height: 0, fps: null, tatsaechlich: true };
  }
  async start(): Promise<void> {
    const v = this.element;
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new SourceError('format', 'Die Videodatei konnte nicht gelesen werden. Unterstützt sind MP4 (H.264) und WebM.')); });
    this.infoV = { ...this.infoV, width: v.videoWidth, height: v.videoHeight };
    v.playbackRate = this.opt.playbackRate ?? 1;
    this.running = true;
    await v.play();
    this.loop();
  }
  private emit = async (meta?: VideoFrameCallbackMetadata): Promise<void> => {
    const v = this.element;
    const k = Math.min(1, (this.opt.maxFrameWidth ?? 960) / v.videoWidth);
    const bmp = await createImageBitmap(v, { resizeWidth: Math.round(v.videoWidth * k), resizeHeight: Math.round(v.videoHeight * k), resizeQuality: 'low' });
    // Videozeit (mediaTime) als Zeitbasis → deterministisch, unabhängig von der Abspielgeschwindigkeit der Pipeline
    const t = (meta?.mediaTime ?? v.currentTime) * 1000;
    const f: Frame = { bitmap: bmp, captureTime: t, frameIndex: this.idx++, width: bmp.width, height: bmp.height };
    for (const c of this.cbs) c(f);
  };
  private loop(): void {
    const v = this.element;
    const step = async (_n: number, meta?: VideoFrameCallbackMetadata): Promise<void> => {
      if (!this.running) return;
      if (this.cbs.size && !v.paused) await this.emit(meta);
      v.requestVideoFrameCallback(step);
    };
    v.requestVideoFrameCallback(step);
  }
  /** Springt zu einer Zeit (s) und liefert genau ein Frame – für deterministische Tests/Replay. */
  async stepTo(seconds: number): Promise<void> {
    const v = this.element; v.pause();
    await new Promise<void>((res) => { v.onseeked = () => res(); v.currentTime = seconds; });
    await this.emit();
  }
  pause(): void { this.element.pause(); }
  resume(): void { void this.element.play(); }
  get duration(): number { return this.element.duration; }
  onFrame(cb: (f: Frame) => void): () => void { this.cbs.add(cb); return () => this.cbs.delete(cb); }
  info(): SourceInfo { return this.infoV; }
  stop(): void { this.running = false; this.element.pause(); URL.revokeObjectURL(this.url); }
}
