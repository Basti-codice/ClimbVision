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
