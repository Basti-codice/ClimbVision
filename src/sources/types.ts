export interface Frame { bitmap: ImageBitmap; captureTime: number; frameIndex: number; width: number; height: number }
export interface SourceInfo { kind: 'kamera' | 'datei'; label: string; width: number; height: number; fps: number | null; /** vom Gerät tatsächlich gelieferte Werte (nicht die gewünschten) */ tatsaechlich: boolean }
export interface FrameSource {
  start(): Promise<void>;
  stop(): void;
  onFrame(cb: (f: Frame) => void): () => void;
  info(): SourceInfo;
  /** Aktuelles Videoelement für die Vorschau (falls vorhanden). */
  readonly element: HTMLVideoElement | null;
}
export class SourceError extends Error { constructor(public readonly code: 'verweigert' | 'nicht_gefunden' | 'belegt' | 'einschraenkung' | 'unbekannt' | 'format', message: string) { super(message); } }

/** Übersetzt getUserMedia-Fehler in verständliche deutsche Meldungen. */
export function describeMediaError(e: unknown): SourceError {
  const name = (e as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new SourceError('verweigert', 'Der Kamerazugriff wurde verweigert. Bitte in der Adressleiste des Browsers die Kameraberechtigung für diese Seite erlauben.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' && false) return new SourceError('nicht_gefunden', 'Keine Kamera gefunden. Ist das Handy im USB-Webcam-Modus verbunden (Android: Einstellungen → USB → Webcam)?');
  if (name === 'NotReadableError' || name === 'AbortError') return new SourceError('belegt', 'Die Kamera wird bereits von einer anderen Anwendung verwendet. Bitte andere Programme (Zoom, Teams, Kamera-App) schließen.');
  if (name === 'OverconstrainedError') return new SourceError('einschraenkung', 'Die gewünschte Auflösung/Bildrate wird von der Kamera nicht unterstützt. Bitte eine andere Einstellung wählen.');
  return new SourceError('unbekannt', `Die Kamera konnte nicht geöffnet werden (${name || String(e)}).`);
}

/**
 * Wartet, bis ein Videoelement ein dekodiertes UND präsentiertes Bild hat. readyState ≥ 2 reicht nicht: direkt nach dem Start steht
 * currentTime noch auf 0 und createImageBitmap schlägt mit "The image source is not usable" fehl. requestVideoFrameCallback meldet das erste echte Bild.
 */
export async function waitForVideoFrame(v: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  const t0 = performance.now();
  while (v.readyState < 2 || !v.videoWidth) {
    if (performance.now() - t0 > timeoutMs) throw new SourceError('unbekannt', 'Die Quelle liefert noch kein Bild. Bitte kurz warten und erneut versuchen.');
    await new Promise((r) => setTimeout(r, 40));
  }
  if ('requestVideoFrameCallback' in v && !v.paused) {
    await Promise.race([new Promise<void>((r) => v.requestVideoFrameCallback(() => r())), new Promise<void>((r) => setTimeout(r, Math.max(500, timeoutMs - (performance.now() - t0))))]);
  } else await new Promise((r) => setTimeout(r, 120));
}

/**
 * Hängt ein Videoelement unsichtbar (aber gerendert) ins DOM. Ein losgelöstes <video> wird von Chrome nicht "präsentiert":
 * dann liefern createImageBitmap, WebGL-Texturen und requestVideoFrameCallback keine Bilder.
 */
export function mountHidden(v: HTMLVideoElement): void {
  let host = document.getElementById('cv-video-host');
  if (!host) { host = document.createElement('div'); host.id = 'cv-video-host'; host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'position:fixed;right:0;bottom:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1'; document.body.appendChild(host); }
  v.style.cssText = 'width:2px;height:2px'; host.appendChild(v);
}
export function unmountHidden(v: HTMLVideoElement): void { v.remove(); }
