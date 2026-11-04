/** Globaler Anwendungszustand (Svelte-5-Runes). Persistenz in IndexedDB. */
import { Store, openDb } from '../storage/db';
import type { Hold, Route, SessionDoc, WallProfile } from '../core/schemas';
import type { Rgba } from '../image/raster';
import type { FrameOutput } from '../pipeline/live';
import type { EngineStats } from '../engine/live';
import type { Mat3 } from '../geometry/homography';
import type { RegistrierungsQualitaet } from '../core/schemas';
import { setLang, type Lang } from '../i18n';
import { Esp32Service } from './esp32';
import { CvClient } from './cv';
import { bitmapToRgba, blobToBytes, rgbaToImageBitmap } from './imageio';
import { migrate } from '../core/migrate';
import { selectAnchors, type Anchor } from '../registration/drift';
import { toGray } from '../image/raster';

export interface Settings {
  poseModel: 'pose_lite' | 'pose_full';
  useHands: boolean; delegate: 'CPU' | 'GPU'; swapLeftRight: boolean;
  tolHandCm: number; tolFootCm: number; oneEuroMinCutoff: number; oneEuroBeta: number;
  thetaOn: number; thetaOff: number; handIntervalMs: number;
  showIds: boolean; showSkeleton: boolean; showConf: boolean; debug: boolean; wallBackground: 'live' | 'foto' | 'dunkel'; videoOpacity: number;
  lang: Lang; highContrast: boolean; recordData: boolean; recordVideo: boolean; esp32Url: string; cameraWidth: number; cameraFps: number;
}
export const DEFAULT_SETTINGS: Settings = {
  poseModel: 'pose_lite', useHands: true, delegate: 'CPU', swapLeftRight: false, tolHandCm: 4, tolFootCm: 5, oneEuroMinCutoff: 1.5, oneEuroBeta: 0.05,
  thetaOn: 0.65, thetaOff: 0.4, handIntervalMs: 100, showIds: false, showSkeleton: true, showConf: true, debug: false,   wallBackground: 'live', videoOpacity: 0.85, lang: 'de', highContrast: false, recordData: true, recordVideo: false, esp32Url: 'ws://192.168.4.1:81', cameraWidth: 1280, cameraFps: 30,
};

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'warn' | 'err' }
export interface Registration { ampel: 'gruen' | 'gelb' | 'rot' | 'unbekannt'; h: Mat3 | null; quality: RegistrierungsQualitaet | null }

class AppState {
  ready = $state(false);
  leftOpen = $state(true); rightOpen = $state(true); contentMode = $state(false);
  sections = $state<Record<string, boolean>>({ kontakte: true, status: true, hud: true, debug: false, auswertung: true });
  settings = $state<Settings>({ ...DEFAULT_SETTINGS });
  profiles = $state<WallProfile[]>([]);
  profile = $state<WallProfile | null>(null);
  holds = $state<Hold[]>([]);
  routes = $state<Route[]>([]);
  rect = $state.raw<Rgba | null>(null);          // entzerrtes Referenzbild (groß → nicht tief reaktiv, übertragbar)
  rectBitmap = $state.raw<ImageBitmap | null>(null);
  sessions = $state<SessionDoc[]>([]);
  toasts = $state<Toast[]>([]);
  modelsCached = $state<Record<string, boolean>>({});
  registration = $state<Registration>({ ampel: 'unbekannt', h: null, quality: null });
  // Live
  output = $state<FrameOutput | null>(null);
  stats = $state<EngineStats | null>(null);
  renderFps = $state(0);
  live = $state(false);
  /** Laufender Modell-Download (einmalig, beim ersten Start der Erkennung). */
  modelProgress = $state<{ name: string; fraction: number } | null>(null);
  /** Arbeitsbereich: 'setup' (Wand einrichten), 'live', 'edit' (Griffe), 'replay' (Aufnahmen). Die Wandkarte ist immer in der Mitte. */
  mode = $state<'setup' | 'live' | 'edit' | 'replay'>('live');
  settingsOpen = $state(false);
  /** Von Bibliotheken versuchte externe Anfragen, die der Netzwerkwächter abgewehrt hat (Datenschutz-Anzeige). */
  blockedExternal = $state<{ count: number; last: string }>({ count: 0, last: '' });

  /** Von der Bühne gesetzt: Wandkarte auf einen Punkt zoomen / Ansicht zurücksetzen / Screenshot. */
  stageApi: { focus(u: number, v: number, z?: number): void; reset(): void; png(): Promise<Blob | null>; canvas(): HTMLCanvasElement | null; project(u: number, v: number): [number, number]; zoom(): number } | null = null;
  store!: Store;
  cv = new CvClient();
  esp = new Esp32Service();
  anchors: Anchor[] = [];
  private toastId = 0;

  async init(): Promise<void> {
    this.store = new Store(await openDb());
    const saved = await this.store.getSetting<Partial<Settings>>('settings', {});
    this.settings = { ...DEFAULT_SETTINGS, ...saved };
    setLang(this.settings.lang);
    this.profiles = await this.store.listProfiles();
    const last = await this.store.getSetting<string | null>('activeProfile', null);
    const target = this.profiles.find((p) => p.id === last) ?? this.profiles[0];
    if (target) await this.selectProfile(target.id);
    await this.refreshModels();
    this.mode = this.profile ? 'live' : 'setup';
    this.ready = true;
  }

  async saveSettings(): Promise<void> { await this.store.setSetting('settings', $state.snapshot(this.settings)); setLang(this.settings.lang); }
  async refreshModels(): Promise<void> {
    const { isCached } = await import('./models');
    const out: Record<string, boolean> = {};
    for (const id of ['pose_lite', 'pose_full', 'pose_heavy', 'hand'] as const) out[id] = await isCached(this.store, id);
    this.modelsCached = out;
  }

  async selectProfile(id: string): Promise<void> {
    const p = await this.store.getProfile(id);
    if (!p) return;
    await this.store.setSetting('activeProfile', id);
    const h = await this.store.getHolds(id);
    this.holds = h?.griffe ?? [];
    this.routes = await this.store.listRoutes(id);
    this.sessions = await this.store.listSessions(id);
    const rb = await this.store.getBlob(p.referenz_entzerrt.blobId);
    this.rectBitmap?.close();
    if (rb) {
      const bmp = await createImageBitmap(new Blob([rb.data as BlobPart], { type: rb.mime }));
      this.rect = await bitmapToRgba(bmp); this.rectBitmap = bmp;
    } else { this.rect = null; this.rectBitmap = null; }
    this.registration = { ampel: 'unbekannt', h: null, quality: p.registrierung.letzte_qualitaet };
    this.recomputeAnchors();
    this.profile = p; // zuletzt setzen: abhängige Seiten sehen konsistente Griffe/Bilder
  }

  private anchorsDirty = true;
  /** Anker werden nur bei Bedarf (Live/Drift-Monitor) berechnet und gecacht – nicht bei jedem Editor-Autosave. */
  recomputeAnchors(): void { this.anchorsDirty = true; }
  ensureAnchors(): Anchor[] {
    if (this.anchorsDirty) { this.anchors = this.rect ? selectAnchors(toGray(this.rect)) : []; this.anchorsDirty = false; }
    return this.anchors;
  }

  /** Nach dem Setup ist die Aufstellung identisch zur Referenz → Registrierung gilt als bestanden. */
  trustReference(): void { if (this.profile) this.registration = { ampel: 'gruen', h: this.profile.homographie as unknown as Mat3, quality: null }; }

  async setHolds(holds: Hold[]): Promise<void> {
    this.holds = holds;
    if (!this.profile) return;
    await this.store.putHolds({ schemaVersion: 1, typ: 'Holds', wandId: this.profile.id, erstellt: new Date().toISOString(), griffe: $state.snapshot(holds) as Hold[] });
    this.recomputeAnchors();
  }

  toast(text: string, kind: Toast['kind'] = 'info', ms = 6000): void {
    const id = ++this.toastId;
    this.toasts = [...this.toasts, { id, text, kind }];
    setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, ms);
  }
  error(e: unknown, prefix = ''): void { this.toast(prefix + ((e as Error)?.message ?? String(e)), 'err', 9000); }

  async importHoldsFile(file: File): Promise<void> {
    const json = JSON.parse(await file.text()) as unknown;
    const r = migrate(json);
    if (r.typ !== 'Holds') throw new Error('Das ist keine Griff-Datei (holds.json).');
    await this.setHolds((r.doc as { griffe: Hold[] }).griffe);
    this.toast(`${this.holds.length} Griffe importiert.` + (r.vonVersion < 1 ? ' (ältere Version wurde migriert)' : ''), 'ok');
  }
}

export const app = new AppState();
export { blobToBytes, rgbaToImageBitmap };
