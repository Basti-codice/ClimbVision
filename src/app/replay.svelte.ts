/** Replay & Auswertung (Modus „Aufnahmen“): Abspielen, Scrubbing, Zeitlupe, Analyse, Routen, Export. */
import { app } from './state.svelte';
import type { Hold, Route, SessionDoc } from '../core/schemas';
import { LIMBS } from '../core/schemas';
import { ReplayEngine, decodeChunk, N_KP } from '../session/recorder';
import { compareToRoute, dynamicShare, holdUsage, leftRight, moveSequence, pathLengthCm, pauses, segmentAttempts, seriesFromReplay, stat, timePerMove } from '../session/analysis';
import { eventsCsv, projectZip, timeseriesCsv } from '../export/exporters';
import { pointInPolygon } from '../geometry/polygon';
import type { RenderState, WallPointer } from '../ui/wallTypes';
import type { Chunk } from '../session/recorder';

const dl = (name: string, data: BlobPart | Uint8Array, type: string): void => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data as BlobPart], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };

class ReplayController {
  cur = $state.raw<SessionDoc | null>(null);
  rp = $state.raw<ReplayEngine | null>(null);
  ghost = $state.raw<ReplayEngine | null>(null);
  ghostId = $state('');
  pos = $state(0);
  playing = $state(false);
  speed = $state(1);
  heat = $state(false);
  routeId = $state('');
  editRoute = $state(false);
  routeName = $state('Neue Route');
  draftRole = $state<'start' | 'hand' | 'fuss' | 'top'>('hand');
  draft = $state.raw<Route['griffe']>([]);
  version = $state(0);
  private last = 0;

  get cm(): number { return app.profile?.hoehe_cm ?? (app.profile?.breite_cm ? app.profile.breite_cm / app.profile.aspekt : 240); }
  get events() { return this.cur?.events ?? []; }
  get moves() { return moveSequence(this.events); }
  get usage() { return holdUsage(this.events, this.cur?.dauer_ms ?? 0); }
  get lr() { return leftRight(this.usage); }
  get series() { return this.rp && app.profile ? seriesFromReplay(this.rp, app.profile.aspekt, this.cm) : null; }
  get route(): Route | null { return app.routes.find((r) => r.id === this.routeId) ?? null; }
  get attempts() { return this.route && this.cur ? segmentAttempts(this.events, this.route, this.cur.dauer_ms) : []; }
  get compare() { return this.route ? compareToRoute(this.moves, this.route) : null; }
  get summary() {
    const s = this.series, m = this.moves;
    return {
      zuege: m.length, proZug: stat(timePerMove(m)).mean / 1000, pausen: pauses(m).length,
      hueftbahnM: s ? pathLengthCm(s.hip, this.cm) / 100 : NaN, span: s ? stat(s.span) : null,
      elbowL: s ? stat(s.elbowL) : null, elbowR: s ? stat(s.elbowR) : null, kneeL: s ? stat(s.kneeL) : null, kneeR: s ? stat(s.kneeR) : null,
      dyn: s ? dynamicShare(s, this.cm) : null,
    };
  }
  get fills(): Map<number, string> | undefined {
    void this.version;
    if (this.heat) { const mx = this.usage[0]?.ms ?? 1; return new Map(this.usage.map((u) => [u.holdId, `rgba(255,${Math.round(200 - 160 * (u.ms / mx))},60,${0.2 + 0.6 * (u.ms / mx)})`])); }
    const src = this.editRoute ? this.draft : this.route?.griffe; if (!src?.length) return undefined;
    const c: Record<string, string> = { start: 'rgba(61,220,151,.4)', hand: 'rgba(124,196,255,.3)', fuss: 'rgba(204,121,167,.3)', top: 'rgba(255,200,87,.45)' };
    return new Map(src.map((g) => [g.holdId, c[g.rolle] as string]));
  }

  private async loadReplay(s: SessionDoc): Promise<ReplayEngine> {
    const chunks: Chunk[] = [];
    for (const id of s.chunkIds) { const b = await app.store.getChunk(id); if (b) chunks.push(decodeChunk(b)); }
    return new ReplayEngine(chunks);
  }
  async open(s: SessionDoc): Promise<void> {
    this.playing = false; this.cur = s; this.rp = await this.loadReplay(s); this.pos = 0; this.heat = false; this.ghostId = ''; this.ghost = null;
    if (this.rp.length === 0) app.toast('Diese Aufnahme enthält keine Zeitreihe.', 'warn');
  }
  async chooseGhost(id: string): Promise<void> { this.ghostId = id; const g = app.sessions.find((x) => x.id === id); this.ghost = g ? await this.loadReplay(g) : null; }
  close(): void { this.playing = false; this.cur = null; this.rp = null; this.ghost = null; }

  /** Pro Animationsframe aufrufen. */
  tick(now: number): void {
    const rp = this.rp;
    if (!rp || !this.playing) { this.last = now; return; }
    rp.playing = true; rp.speed = this.speed; rp.seek(this.pos); rp.tick(now - this.last); this.pos = rp.position; if (!rp.playing) this.playing = false; this.last = now;
  }
  toggle(): void { if (!this.rp) return; if (!this.playing && this.pos >= this.rp.durationMs) this.pos = 0; this.playing = !this.playing; }
  step(d: number): void { const rp = this.rp; if (!rp) return; this.playing = false; rp.seek(this.pos); const f = rp.stepFrame(d); if (f) this.pos = f.t; }

  frameState = (): RenderState => {
    const f = this.rp?.frameAt(this.pos); if (!f) return { limbs: {}, skeleton: null };
    const limbs: RenderState['limbs'] = {};
    LIMBS.forEach((l, i) => { const h = f.hold[i] as number; if (h >= 0) limbs[l] = { holdId: h, confidence: (f.conf[i] as number) / 100, state: 'HOLDING', evidence: 'gesehen' }; });
    const sk = Array.from({ length: N_KP }, (_, i) => { const u = f.kp[i * 3] as number; return Number.isFinite(u) ? { u, v: f.kp[i * 3 + 1] as number, c: f.kp[i * 3 + 2] as number } : null; });
    return { limbs, skeleton: sk };
  };
  overlay = (ctx: CanvasRenderingContext2D, tf: (u: number, v: number) => [number, number]): void => {
    const g = this.ghost?.frameAt(this.pos); if (!g) return;
    ctx.save(); ctx.strokeStyle = 'rgba(200,200,255,.45)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const [a, b] of [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]] as [number, number][]) {
      const ua = g.kp[a * 3] as number, ub = g.kp[b * 3] as number; if (!Number.isFinite(ua) || !Number.isFinite(ub)) continue;
      const [x1, y1] = tf(ua, g.kp[a * 3 + 1] as number), [x2, y2] = tf(ub, g.kp[b * 3 + 1] as number); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  };

  // Routen
  onwall = (e: WallPointer): void => {
    if (!this.editRoute || e.type !== 'down') return; const h = app.holds.find((x: Hold) => pointInPolygon([e.u, e.v], x.polygon)); if (!h) return;
    const i = this.draft.findIndex((g) => g.holdId === h.id);
    this.draft = i >= 0 ? this.draft.filter((_, k) => k !== i) : [...this.draft, { holdId: h.id, rolle: this.draftRole, reihenfolge: this.draft.length + 1 }]; this.version++;
  };
  async saveRoute(): Promise<void> { if (!app.profile || !this.draft.length) return; const r: Route = { schemaVersion: 1, typ: 'Route', id: crypto.randomUUID(), wandId: app.profile.id, name: this.routeName || 'Route', griffe: this.draft, zugfolge: [] }; await app.store.putRoute(r); app.routes = await app.store.listRoutes(app.profile.id); this.routeId = r.id; this.editRoute = false; this.draft = []; this.version++; app.toast('Route gespeichert.', 'ok'); }
  async deleteRoute(): Promise<void> { const r = this.route; if (!r || !confirm('Route löschen?')) return; await app.store.deleteRoute(r.id); app.routes = await app.store.listRoutes(app.profile!.id); this.routeId = ''; }
  async deleteSession(s: SessionDoc): Promise<void> { if (!confirm('Aufnahme unwiderruflich löschen?')) return; await app.store.deleteSession(s.id); app.sessions = await app.store.listSessions(app.profile?.id); if (this.cur?.id === s.id) this.close(); }

  // Export
  exportJson(): void { if (this.cur) dl(`session-${this.cur.id.slice(0, 8)}.json`, JSON.stringify(this.cur, null, 1), 'application/json'); }
  exportEvents(): void { if (this.cur) dl(`ereignisse-${this.cur.id.slice(0, 8)}.csv`, eventsCsv(this.cur.events), 'text/csv'); }
  exportSeries(): void { if (this.rp && this.cur) dl(`zeitreihe-${this.cur.id.slice(0, 8)}.csv`, timeseriesCsv(this.rp), 'text/csv'); }
  async exportZip(): Promise<void> {
    const p = app.profile; if (!p) return; const blobs: Record<string, Uint8Array> = {}, chunks: Record<string, Uint8Array> = {};
    for (const id of [p.referenzfoto.blobId, p.referenz_entzerrt.blobId]) { const b = await app.store.getBlob(id); if (b) blobs[id.replace(/[:]/g, '_')] = b.data; }
    for (const s of app.sessions) for (const c of s.chunkIds) { const b = await app.store.getChunk(c); if (b) chunks[c] = b; }
    dl(`climbvision-${p.name.replace(/\W+/g, '_')}.zip`, projectZip({ profile: $state.snapshot(p) as typeof p, holds: { schemaVersion: 1, typ: 'Holds', wandId: p.id, erstellt: new Date().toISOString(), griffe: $state.snapshot(app.holds) as Hold[] }, routes: $state.snapshot(app.routes) as Route[], sessions: $state.snapshot(app.sessions) as SessionDoc[], blobs, chunks }), 'application/zip');
  }
  /** Overlay-Video: Replay in Echtzeit abspielen und die Wandkarte (Skelett + leuchtende Griffe) per MediaRecorder aufnehmen. */
  async exportVideo(): Promise<void> {
    const c = app.stageApi?.canvas() as (HTMLCanvasElement & { captureStream?: (f: number) => MediaStream }) | null | undefined;
    if (!c?.captureStream || !this.rp) { app.toast('Videoexport wird von diesem Browser nicht unterstützt.', 'warn'); return; }
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' }); const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    this.pos = 0; this.speed = 1; rec.start(500); this.playing = true; app.toast('Overlay-Video wird in Echtzeit aufgenommen …', 'info', 4000);
    await new Promise<void>((r) => { const iv = setInterval(() => { if (!this.playing) { clearInterval(iv); r(); } }, 200); });
    await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); });
    dl('overlay.webm', new Blob(parts, { type: 'video/webm' }), 'video/webm');
  }
  exportBlob(name: string, b: Blob | null): void { if (b) dl(name, b, b.type); }
}

export const replay = new ReplayController();
