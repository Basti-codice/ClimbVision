/** Live-Controller: verbindet Quelle, Registrierung, Engine, Pipeline, Aufnahme, ESP32 und Drift-Überwachung. */
import { app } from './state.svelte';
import { CameraSource, listCameras, type CameraDevice } from '../sources/camera';
import { VideoFileSource } from '../sources/videofile';
import { waitForVideoFrame, type FrameSource } from '../sources/types';
import { LiveEngine } from '../engine/live';
import { LivePipeline, defaultPipelineConfig, type FrameOutput } from '../pipeline/live';
import { downloadModel, isCached, loadModel, type ModelId } from './models';
import { bitmapToRgba, medianFrames, rgbaToBlob, blobToBytes } from './imageio';
import { normalizedHomography, refinedHomography, rectify, verdict, rectSize } from './wizard';
import type { Rgba } from '../image/raster';
import { resizeRgba, toGray } from '../image/raster';
import { measureDrift, type DriftMeasure } from '../registration/drift';
import { SessionRecorder, encodeChunk } from '../session/recorder';
import { snapshotOf } from './esp32';
import type { Mat3, Vec2 } from '../geometry/homography';
import { applyH, inv3, mul3 } from '../geometry/homography';
import type { RenderState } from '../ui/wallTypes';
import type { SessionDoc } from '../core/schemas';

export type RegPhase = 'aus' | 'aufnahme' | 'ecken' | 'rechnet';

class LiveController {
  devices = $state<CameraDevice[]>([]);
  deviceId = $state('');
  source = $state<FrameSource | null>(null);
  sourceLabel = $state('');
  running = $state(false);
  busy = $state(false);
  armLock = $state(false);
  regPhase = $state<RegPhase>('aus');
  regImage = $state<Rgba | null>(null);
  regBitmap = $state<ImageBitmap | null>(null);
  regCorners = $state<Vec2[]>([]);
  regInfo = $state('');
  drift = $state<DriftMeasure | null>(null);
  paused = $state(false);
  recording = $state(false);
  recFrames = $state(0);
  lastSession = $state<string | null>(null);
  cmAssumed = $state(false);
  videoFile: File | null = null;

  private engine: LiveEngine | null = null;
  pipeline: LivePipeline | null = null;
  private recorder: SessionRecorder | null = null;
  private prev: { out: FrameOutput; at: number } | null = null; private curr: { out: FrameOutput; at: number } | null = null;
  private driftTimer: number | null = null; private okStreak = 0; private badStreak = 0;
  private mediaRec: MediaRecorder | null = null; private videoChunks: Blob[] = []; private sessionId = '';

  async refreshDevices(): Promise<void> { try { this.devices = await listCameras(); if (!this.deviceId && this.devices[0]) this.deviceId = this.devices[0].deviceId; } catch (e) { app.error(e); } }

  /** Quelle öffnen (nur Vorschau, noch keine Erkennung). */
  async openSource(kind: 'kamera' | 'datei', file?: File): Promise<void> {
    this.closeSource(); this.busy = true;
    try {
      const s: FrameSource = kind === 'kamera'
        ? new CameraSource({ deviceId: this.deviceId || undefined, width: app.settings.cameraWidth, fps: app.settings.cameraFps, maxFrameWidth: 960 })
        : new VideoFileSource(file as File, { loop: true, maxFrameWidth: 960 });
      if (kind === 'datei') this.videoFile = file ?? null;
      await s.start(); this.source = s; this.sourceLabel = s.info().label;
      await this.refreshDevices();
      const i = s.info(); app.toast(`Quelle aktiv: ${i.width}×${i.height}${i.fps ? ` @ ${Math.round(i.fps)} fps` : ''}${i.tatsaechlich ? ' (tatsächlich geliefert)' : ''}`, 'ok', 3500);
    } catch (e) { app.error(e); this.source = null; } finally { this.busy = false; }
    if (this.source && app.profile) await this.autoRegister();
  }
  closeSource(): void { void this.stop(); this.source?.stop(); this.source = null; this.sourceLabel = ''; }

  /**
   * Automatische Registrierung: Die Kamera steht an derselben Stelle wie beim Setup-Foto → die gespeicherte Homographie wird direkt
   * auf das Live-Bild angewendet und nur bildbasiert nachjustiert. Keine Klicks nötig. Passt es nicht (Kamera bewegt) → manueller Dialog.
   */
  async autoRegister(silent = false): Promise<boolean> {
    const v = this.source?.element, p = app.profile;
    if (!v || !p || !app.rect) return false;
    this.busy = true; this.regInfo = '';
    try {
      await waitForVideoFrame(v);
      const frames: Rgba[] = [];
      for (let i = 0; i < 3; i++) { const b = await createImageBitmap(v); frames.push(await bitmapToRgba(b, 1280)); b.close(); await new Promise((r) => setTimeout(r, 60)); }
      const img = medianFrames(frames);
      const h0 = p.homographie as unknown as Mat3;
      const sz = rectSize(p.aspekt, 800);
      const neu = rectify(img, h0, p.aspekt, 800);
      const ref = resizeRgba(app.rect, sz.w, sz.h);
      const r = await app.cv.register(ref, neu, ($state.snapshot(app.holds) as typeof app.holds).map((h) => h.polygon), p.aspekt);
      const verd = verdict(r.quality);
      app.registration = { ampel: r.quality.ampel, h: verd.freigabe ? refinedHomography(h0, r.hRes) : null, quality: r.quality };
      this.regInfo = `NCC ${r.quality.ncc.toFixed(2)} · Abweichung ${(r.quality.eckverschiebung * 100).toFixed(2)} %`;
      if (r.quality.ampel === 'gruen') { if (!silent) app.toast('Kamera erkannt – Wand ausgerichtet.', 'ok', 2500); return true; }
      if (r.quality.ampel === 'gelb') { app.toast('Wand ausgerichtet, aber ungenau. Tipp: Kamera nicht bewegen, gleichmäßiges Licht.', 'warn', 7000); return true; }
      app.toast('Die Kamera scheint bewegt worden zu sein. Bitte die Wandecken kurz neu setzen.', 'warn', 8000);
      this.busy = false; await this.beginRegistration(); return false;
    } catch (e) { app.error(e, 'Automatische Ausrichtung fehlgeschlagen: '); return false; } finally { this.busy = false; }
  }

  /** Fehlende Modelle einmalig laden (mit Fortschritt) – kein Umweg über ein Menü. */
  async ensureModels(): Promise<boolean> {
    const need: ModelId[] = [app.settings.poseModel]; if (app.settings.useHands) need.push('hand');
    for (const id of need) {
      if (await isCached(app.store, id)) continue;
      try {
        app.modelProgress = { name: id === 'hand' ? 'Hand-Modell' : 'Pose-Modell', fraction: 0 };
        const r = await downloadModel(app.store, id, (f) => { app.modelProgress = { name: id === 'hand' ? 'Hand-Modell' : 'Pose-Modell', fraction: f }; });
        if (r.hashAbweichung) app.toast('Hinweis: Die Prüfsumme des Modells weicht von der dokumentierten ab.', 'warn');
      } catch (e) { app.error(e); app.modelProgress = null; return false; }
    }
    app.modelProgress = null; await app.refreshModels(); return true;
  }

  // ---------- Registrierung ----------
  /** Schritt 1: aktuelles Bild der laufenden Quelle aufnehmen (Median) → Ecken markieren. */
  async beginRegistration(): Promise<void> {
    const v = this.source?.element; if (!v || !app.profile) { app.toast('Bitte zuerst eine Kamera oder Videodatei öffnen.', 'warn'); return; }
    this.regPhase = 'aufnahme'; this.busy = true;
    try {
      await waitForVideoFrame(v);
      const frames: Rgba[] = []; const wasPaused = v.paused; v.pause();
      for (let i = 0; i < 5; i++) { const b = await createImageBitmap(v); frames.push(await bitmapToRgba(b, 1600)); b.close(); await new Promise((r) => setTimeout(r, 80)); }
      if (!wasPaused) void v.play();
      const img = medianFrames(frames);
      this.regImage = img; this.regBitmap?.close(); this.regBitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height));
      // Startvorschlag: gespeicherte Ecken (normalisiert) auf das neue Bild übertragen
      const p = app.profile, rw = p.referenzfoto.breite_px, rh = p.referenzfoto.hoehe_px;
      this.regCorners = p.ecken_bild.map((c) => [(c[0] / rw) * img.width, (c[1] / rh) * img.height] as Vec2);
      this.regInfo = 'Die Ecken wurden aus der letzten Aufstellung übernommen. Bitte prüfen und ggf. auf die aktuellen Wandecken ziehen.';
      this.regPhase = 'ecken';
    } catch (e) { app.error(e); this.regPhase = 'aus'; } finally { this.busy = false; }
  }
  cancelRegistration(): void { this.regPhase = 'aus'; this.regBitmap?.close(); this.regBitmap = null; }

  /** Schritt 2: Homographie aus den Ecken, Entzerrung, bildbasierte Verfeinerung + Plausibilität. */
  async finishRegistration(): Promise<void> {
    const p = app.profile, img = this.regImage;
    if (!p || !img || !app.rect || this.regCorners.length !== 4) {
      const grund = !p ? 'kein Wandprofil' : !img ? 'kein Kamerabild aufgenommen' : !app.rect ? 'das entzerrte Referenzbild fehlt (Wand im Setup neu anlegen)' : 'es sind nicht alle vier Ecken gesetzt';
      app.toast(`Registrierung nicht möglich: ${grund}.`, 'err'); return;
    }
    this.regPhase = 'rechnet'; this.busy = true;
    try {
      const h0 = normalizedHomography(this.regCorners, img.width, img.height);
      const sz = rectSize(p.aspekt, 800);
      const neu = rectify(img, h0, p.aspekt, 800);
      const ref = resizeRgba(app.rect, sz.w, sz.h);
      // Proxys (Svelte-$state) sind nicht an Worker übertragbar → Schnappschuss
      const r = await app.cv.register(ref, neu, ($state.snapshot(app.holds) as typeof app.holds).map((h) => h.polygon), p.aspekt);
      const h = refinedHomography(h0, r.hRes);
      const v = verdict(r.quality);
      app.registration = { ampel: r.quality.ampel, h: v.freigabe ? h : null, quality: r.quality };
      await app.store.putProfile({ ...p, registrierung: { ...p.registrierung, letzte_qualitaet: r.quality }, geaendert: new Date().toISOString() });
      app.toast(v.text, r.quality.ampel === 'gruen' ? 'ok' : r.quality.ampel === 'gelb' ? 'warn' : 'err', 12000);
      this.regInfo = `NCC ${r.quality.ncc.toFixed(2)} · Eckverschiebung ${(r.quality.eckverschiebung * 100).toFixed(2)} % · Kantenkontrast ${r.quality.griffKontrast.toFixed(2)} · ${Math.round(r.ms)} ms`;
      this.regPhase = 'aus'; this.regBitmap?.close(); this.regBitmap = null;
    } catch (e) { app.error(e, 'Registrierung fehlgeschlagen: '); this.regPhase = 'ecken'; } finally { this.busy = false; }
  }

  // ---------- Live ----------
  async start(): Promise<void> {
    const p = app.profile, s = app.settings;
    if (!p) { app.toast('Bitte zuerst eine Wand einrichten.', 'warn'); return; }
    if (!app.holds.length) { app.toast('Es gibt noch keine Griffe. Wechsle zu „Griffe“ und starte die Erkennung.', 'warn'); return; }
    if (!this.source) { app.toast('Bitte zuerst die Kamera oder eine Videodatei öffnen.', 'warn'); return; }
    if (app.registration.ampel === 'unbekannt' || !app.registration.h) { if (!(await this.autoRegister(true))) return; }
    if (!app.registration.h) { app.toast('Die Wand ist nicht ausgerichtet. Bitte Ecken neu setzen.', 'err'); return; }
    this.busy = true;
    try {
      if (!(await this.ensureModels())) return;
      const pose = await loadModel(app.store, s.poseModel); if (!pose) throw new Error('Pose-Modell fehlt im lokalen Speicher.');
      const hand = s.useHands && app.modelsCached['hand'] ? await loadModel(app.store, 'hand') : null;
      const cm = p.hoehe_cm ?? (p.breite_cm ? p.breite_cm / p.aspekt : 240); this.cmAssumed = !p.hoehe_cm && !p.breite_cm;
      this.pipeline = new LivePipeline(defaultPipelineConfig({
        holds: $state.snapshot(app.holds), aspekt: p.aspekt, homography: app.registration.h as Mat3, frameWidth: 1, frameHeight: 1, cmPerUnit: cm, swapLeftRight: s.swapLeftRight,
        oneEuro: { minCutoff: s.oneEuroMinCutoff, beta: s.oneEuroBeta, dCutoff: 1 }, contact: { tolHandCm: s.tolHandCm, tolFootCm: s.tolFootCm, thetaOn: s.thetaOn, thetaOff: s.thetaOff },
      }));
      this.sessionId = crypto.randomUUID(); const sid = this.sessionId;
      this.recorder = s.recordData ? new SessionRecorder((c, i) => void app.store.putChunk(`${sid}-${i}`, encodeChunk(c))) : null;
      this.engine = new LiveEngine({
        source: this.source as FrameSource, ownsSource: false, pipeline: this.pipeline, poseModel: pose, handModel: hand, delegate: s.delegate, handIntervalMs: s.handIntervalMs, swapLeftRight: s.swapLeftRight,
        onOutput: (o) => this.onOutput(o), onStats: (st) => { app.stats = st; }, onError: (m) => app.toast(m, 'err'), onBlocked: (count, url) => { app.blockedExternal = { count: app.blockedExternal.count + 1, last: url }; void count; },
      });
      await this.engine.start();
      this.running = true; app.live = true; this.okStreak = 0; this.badStreak = 0; this.paused = false;
      this.driftTimer = window.setInterval(() => void this.checkDrift(), 1500);
      if (s.recordVideo && this.source?.element) this.startVideoRecording();
      this.recording = !!this.recorder;
    } catch (e) { app.error(e, 'Live-Start fehlgeschlagen: '); this.engine?.stop(); this.engine = null; } finally { this.busy = false; }
  }

  private onOutput(o: FrameOutput): void {
    const now = performance.now();
    this.prev = this.curr; this.curr = { out: o, at: now };
    app.output = o;
    app.esp.offer(o.contact, now);
    if (this.recorder) { this.recorder.addFrame(o.t, o.skeleton, o.contact); if (o.events.length) this.recorder.addEvents(o.events); this.recFrames = this.recorder.frameCount; }
  }

  /** Rendering-Zustand mit linearer Extrapolation (max. +40 %) zwischen Inferenzschritten → flüssige 60 FPS. */
  renderState = (): RenderState => {
    const c = this.curr; if (!c) return { limbs: {}, skeleton: null };
    const limbs: RenderState['limbs'] = {};
    for (const [k, v] of Object.entries(c.out.contact.limbs)) limbs[k as keyof RenderState['limbs']] = { holdId: v.holdId, confidence: v.confidence, state: v.state, evidence: v.evidence, candidates: v.candidates, ambiguous: v.ambiguous };
    let sk = c.out.skeleton;
    const p = this.prev;
    const psk = p?.out.skeleton;
    if (sk && p && psk) {
      const dt = Math.max(30, c.at - p.at), f = Math.min(1.4, 1 + (performance.now() - c.at) / dt);
      sk = sk.map((pt, i) => { const q = psk[i]; return pt && q ? { u: q.u + (pt.u - q.u) * f, v: q.v + (pt.v - q.v) * f, c: pt.c } : pt; });
    }
    return { limbs, skeleton: sk };
  };

  /** Drift-Überwachung: aktuelles Kamerabild entzerren und mit den Referenz-Ankern vergleichen. */
  private async checkDrift(): Promise<void> {
    const v = this.source?.element, h = app.registration.h, p = app.profile;
    const anchors = app.ensureAnchors();
    if (!v || !h || !p || !anchors.length || !v.videoWidth) return;
    try {
      const k = Math.min(1, 640 / v.videoWidth), w = Math.round(v.videoWidth * k), hh = Math.round(v.videoHeight * k);
      const c = new OffscreenCanvas(w, hh), g = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D; g.drawImage(v, 0, 0, w, hh);
      const img = g.getImageData(0, 0, w, hh);
      const rect = rectify({ width: w, height: hh, data: img.data }, h, p.aspekt, 512);
      const sk = app.output?.skeleton; const boxes: [number, number, number, number][] = [];
      if (sk) { const pts = sk.filter((q): q is NonNullable<typeof q> => !!q && q.c > 0.3); if (pts.length) boxes.push([Math.min(...pts.map((q) => q.u)) - 0.08, Math.min(...pts.map((q) => q.v)) - 0.08, Math.max(...pts.map((q) => q.u)) + 0.08, Math.max(...pts.map((q) => q.v)) + 0.08]); }
      const m = measureDrift(anchors, toGray(rect), { workWidth: 512, maskBoxes: boxes });
      this.drift = m;
      if (m.status === 'verloren') { this.badStreak++; this.okStreak = 0; } else if (m.status === 'ok') { this.okStreak++; this.badStreak = 0; } else { this.badStreak = 0; this.okStreak = 0; }
      if (!this.paused && this.badStreak >= 2) { this.paused = true; this.pipeline?.setPaused(true); app.toast('Kamera scheinbar bewegt – Kontaktzuordnung pausiert. Bitte neu registrieren.', 'warn', 10000); }
      else if (this.paused && this.okStreak >= 3) { this.paused = false; this.pipeline?.setPaused(false); app.toast('Registrierung wiederhergestellt – Zuordnung läuft weiter.', 'ok'); }
    } catch { /* Drift-Prüfung ist best effort */ }
  }

  /** "Person sperren" per Klick auf die Wandkarte: Wandpunkt → Kamerabild (Inverse der Registrierung). */
  lockAtWall(u: number, v: number): void {
    const h = app.registration.h; if (!h) return;
    const q = applyH(inv3(h as Mat3), [u, v]); this.lockPerson({ x: q[0], y: q[1] });
  }
  lockPerson(click: { x: number; y: number }): void { this.engine?.lockAt(click); this.armLock = false; }
  unlockPerson(): void { this.engine?.unlock(); }
  setPaused(p: boolean): void { this.paused = p; this.pipeline?.setPaused(p); }

  private startVideoRecording(): void {
    try {
      const v = this.source?.element as HTMLVideoElement & { captureStream?: () => MediaStream }; if (!v?.captureStream) return;
      this.mediaRec = new MediaRecorder(v.captureStream(), { mimeType: 'video/webm' }); this.videoChunks = [];
      this.mediaRec.ondataavailable = (e) => { if (e.data.size) this.videoChunks.push(e.data); }; this.mediaRec.start(1000);
    } catch { app.toast('Videoaufnahme wird von diesem Browser nicht unterstützt.', 'warn'); }
  }

  async stop(): Promise<void> {
    if (this.driftTimer !== null) { clearInterval(this.driftTimer); this.driftTimer = null; }
    const eng = this.engine; this.engine = null;
    const rec = this.recorder; this.recorder = null;
    const wasRunning = this.running; this.running = false; app.live = false;
    if (eng) { eng.stop(); }
    if (this.mediaRec && this.mediaRec.state !== 'inactive') { const mr = this.mediaRec; await new Promise<void>((r) => { mr.onstop = () => r(); mr.stop(); }); }
    if (wasRunning && rec && app.profile && rec.frameCount > 10) {
      try {
        rec.finish();
        let videoBlobId: string | undefined;
        if (this.videoChunks.length) { videoBlobId = `${this.sessionId}:video`; await app.store.putBlob(videoBlobId, 'video/webm', await blobToBytes(new Blob(this.videoChunks, { type: 'video/webm' }))); this.videoChunks = []; }
        const p = app.profile, info = this.source?.info();
        const n = Math.ceil(rec.frameCount / 150);
        const doc: SessionDoc = {
          schemaVersion: 1, typ: 'Session', id: this.sessionId, wandId: p.id,
          wand_snapshot: { homographie: (app.registration.h ?? p.homographie) as SessionDoc['wand_snapshot']['homographie'], aspekt: p.aspekt, griffe_anzahl: app.holds.length, qualitaet: app.registration.quality },
          kamera_kalibrierung: { quelle: info?.label ?? '', breite_px: info?.width ?? 0, hoehe_px: info?.height ?? 0, fps: info?.fps ?? null },
          modell: { pose: app.settings.poseModel, hand: app.settings.useHands ? 'hand' : null }, start: new Date(Date.now() - rec.dauerMs).toISOString(), dauer_ms: rec.dauerMs,
          chunkIds: Array.from({ length: n }, (_, i) => `${this.sessionId}-${i}`), events: rec.events,
          einstellungen: { ...$state.snapshot(app.settings) as unknown as Record<string, unknown>, ...(videoBlobId ? { videoBlobId } : {}), cmPerUnit: p.hoehe_cm ?? null },
        };
        await app.store.putSession(doc); app.sessions = await app.store.listSessions(p.id); this.lastSession = doc.id;
        app.toast(`Session gespeichert (${(doc.dauer_ms / 1000).toFixed(0)} s, ${doc.events.length} Ereignisse).`, 'ok');
      } catch (e) { app.error(e, 'Session konnte nicht gespeichert werden: '); }
    }
    this.recording = false; this.prev = this.curr = null; this.pipeline = null; this.drift = null; app.output = null; app.stats = null;
  }
}

export const live = new LiveController();
export { snapshotOf, rgbaToBlob, mul3 };
