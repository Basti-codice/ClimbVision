/** Griff-Editor: Zustand, Werkzeuge und Pointer-Logik. Die UI (Wandkarte + Leisten) ist dünn und ruft nur diese Methoden auf. */
import { app } from './state.svelte';
import type { Hold } from '../core/schemas';
import type { Vec2 } from '../geometry/homography';
import { History, addPolygon, autoNumber, deleteHolds, filterBySize, makeHold, medianArea, mergeHolds, moveHold, moveVertex, splitHold, updateHold } from '../holds/editor';
import { magicWand } from '../holds/segment';
import { area, centroid, compactness, distToSegment, pointInPolygon, signedDistance } from '../geometry/polygon';
import { resizeRgba } from '../image/raster';
import type { WallPointer } from '../ui/wallTypes';
import { color } from '../design/tokens';

export type Tool = 'select' | 'add' | 'draw' | 'split' | 'vertex';

class EditorController {
  work = $state.raw<Hold[]>([]);
  selected = $state.raw<Set<number>>(new Set());
  version = $state(0);
  tool = $state<Tool>('select');
  scanning = $state(false);
  progress = $state(0);
  step = $state('');
  sensitivity = $state(0.5);
  polarity = $state<'auto' | 'hell' | 'dunkel'>('auto');
  wandTol = $state(28);
  showSuspicious = $state(true);
  lastInfo = $state('');
  private hist = new History<Hold[]>([]);
  private cancelScan: (() => void) | null = null;
  private saveTimer: number | undefined;
  private drag: { kind: 'move' | 'vertex' | 'marquee'; id: number; idx: number; u0: number; v0: number; base: Hold[] } | null = null;
  private marquee: { u0: number; v0: number; u1: number; v1: number } | null = null;
  private drawPts: Vec2[] = [];
  private splitA: Vec2 | null = null;
  private splitB: Vec2 | null = null;
  private suspIdx = -1;

  get canUndo(): boolean { void this.version; return this.hist.canUndo; }
  get canRedo(): boolean { void this.version; return this.hist.canRedo; }
  get single(): Hold | null { return this.selected.size === 1 ? (this.work.find((h) => h.id === [...this.selected][0]) ?? null) : null; }
  get medianArea(): number { return medianArea(this.work); }

  /** Beim Wechsel des Wandprofils neu laden. */
  load(): void { this.work = app.holds; this.hist = new History<Hold[]>(app.holds); this.selected = new Set(); this.suspIdx = -1; this.version++; }
  private bump(): void { this.version++; }
  private aspekt(): number { return app.profile?.aspekt ?? 1; }

  commit(next: Hold[], keepSel = true): void {
    this.hist.push(next); this.work = next; if (!keepSel) this.selected = new Set(); this.bump();
    clearTimeout(this.saveTimer); this.saveTimer = window.setTimeout(() => void app.setHolds(this.work), 600);
  }
  flush(): void { clearTimeout(this.saveTimer); if (app.profile) void app.setHolds(this.work); }
  undo(): void { if (this.hist.undo()) { this.work = this.hist.present; this.selected = new Set(); this.bump(); void app.setHolds(this.work); } }
  redo(): void { if (this.hist.redo()) { this.work = this.hist.present; this.selected = new Set(); this.bump(); void app.setHolds(this.work); } }

  // ---------- Erkennung ----------
  async scan(): Promise<void> {
    if (!app.rect || !app.profile) return;
    this.scanning = true; this.progress = 0; this.step = 'Starte …';
    try {
      const k = Math.min(1, 1200 / Math.max(app.rect.width, app.rect.height));
      const img = k < 1 ? resizeRgba(app.rect, Math.round(app.rect.width * k), Math.round(app.rect.height * k)) : app.rect;
      const s = this.sensitivity;
      const job = app.cv.segment(img, { polarity: this.polarity, localContrast: 10 - 8 * s, minAreaFrac: 0.00012 - 0.00009 * s, splitRel: 0.35 - 0.2 * s, openRadius: s > 0.7 ? 1 : 2 }, (f, st) => { this.progress = f; this.step = st; });
      this.cancelScan = job.cancel; const r = await job.promise; this.cancelScan = null;
      const med0 = r.polygons.length ? ([...r.polygons.map((p) => area(p))].sort((a, b) => a - b)[r.polygons.length >> 1] ?? 0) : 0;
      const holds = autoNumber(r.polygons.map((p, i) => makeHold(i + 1, p, 'auto', med0)));
      this.commit(holds, false);
      const n = this.suspicious().length;
      this.lastInfo = `${holds.length} Griffe erkannt${n ? `, ${n} zum Prüfen markiert` : ''}.`;
      app.toast(this.lastInfo, 'ok');
    } catch (e) { if (this.scanning) app.error(e, 'Griff-Erkennung fehlgeschlagen: '); }
    finally { this.scanning = false; this.cancelScan = null; }
  }
  abortScan(): void { this.cancelScan?.(); app.cv.dispose(); this.scanning = false; app.toast('Erkennung abgebrochen.', 'warn'); }

  // ---------- Prüfhilfe ----------
  /** Verdächtige Griffe: sehr klein/groß, unförmig. */
  suspicious(): number[] {
    void this.version; const med = medianArea(this.work);
    return this.work.filter((h) => (med > 0 && (h.flaeche / med < 0.15 || h.flaeche / med > 3.5)) || compactness(h.polygon) < 0.38).map((h) => h.id);
  }
  /** Springt zum nächsten verdächtigen Griff. Gibt dessen Schwerpunkt zurück (für Zoom). */
  nextSuspicious(dir = 1): Vec2 | null {
    const ids = this.suspicious(); if (!ids.length) return null;
    this.suspIdx = (this.suspIdx + dir + ids.length) % ids.length;
    const h = this.work.find((x) => x.id === ids[this.suspIdx]); if (!h) return null;
    this.selected = new Set([h.id]); this.bump(); return h.schwerpunkt;
  }

  // ---------- Aktionen ----------
  deleteSelected(): void { if (this.selected.size) this.commit(deleteHolds(this.work, this.selected), false); }
  mergeSelected(): void { if (this.selected.size > 1) this.commit(mergeHolds(this.work, [...this.selected])); }
  renumber(): void { this.commit(autoNumber(this.work), false); }
  patch(id: number, p: Partial<Omit<Hold, 'id'>>): void { this.commit(updateHold(this.work, id, p)); }
  setId(oldId: number, nid: number): boolean { if (this.work.some((h) => h.id === nid)) return false; this.commit(this.work.map((h) => (h.id === oldId ? { ...h, id: nid } : h))); this.selected = new Set([nid]); return true; }
  removeSmall(minRel: number): number { const n = filterBySize(this.work, minRel, 1e9); const d = this.work.length - n.length; if (d) this.commit(n, false); return d; }
  selectAll(): void { this.selected = new Set(this.work.map((h) => h.id)); this.bump(); }

  // ---------- Pointer ----------
  private hit(u: number, v: number): Hold | null {
    const a = this.aspekt();
    for (let i = this.work.length - 1; i >= 0; i--) { const h = this.work[i] as Hold; if (pointInPolygon([u, v], h.polygon)) return h; }
    let best: Hold | null = null, bd = 0.012;
    for (const h of this.work) { const d = signedDistance([u * a, v], h.polygon.map((p) => [p[0] * a, p[1]] as Vec2)); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  setTool(t: Tool): void { this.tool = t; this.drawPts = []; this.splitA = this.splitB = null; this.marquee = null; this.bump(); }

  onwall = (e: WallPointer): void => {
    const asp = this.aspekt();
    if (this.tool === 'select') {
      if (e.type === 'down' && e.button === 0) {
        const h = this.hit(e.u, e.v);
        if (h) {
          const s = new Set(this.selected);
          if (e.shift) { if (s.has(h.id)) s.delete(h.id); else s.add(h.id); } else if (!s.has(h.id)) { s.clear(); s.add(h.id); }
          this.selected = s; this.drag = { kind: 'move', id: h.id, idx: 0, u0: e.u, v0: e.v, base: this.work };
        } else { if (!e.shift) this.selected = new Set(); this.drag = { kind: 'marquee', id: 0, idx: 0, u0: e.u, v0: e.v, base: this.work }; this.marquee = { u0: e.u, v0: e.v, u1: e.u, v1: e.v }; }
        this.bump();
      } else if (e.type === 'move' && this.drag) {
        if (this.drag.kind === 'move') { let n = this.drag.base; for (const id of this.selected) n = moveHold(n, id, e.u - this.drag.u0, e.v - this.drag.v0); this.work = n; this.bump(); }
        else if (this.drag.kind === 'marquee' && this.marquee) { this.marquee = { ...this.marquee, u1: e.u, v1: e.v }; this.bump(); }
      } else if (e.type === 'up' && this.drag) {
        const d = this.drag; this.drag = null;
        if (d.kind === 'move') { if (this.work !== d.base) { let n = d.base; for (const id of this.selected) n = moveHold(n, id, e.u - d.u0, e.v - d.v0); this.work = d.base; this.commit(n); } }
        else if (d.kind === 'marquee' && this.marquee) {
          const m = this.marquee; this.marquee = null;
          const x0 = Math.min(m.u0, m.u1), x1 = Math.max(m.u0, m.u1), y0 = Math.min(m.v0, m.v1), y1 = Math.max(m.v0, m.v1);
          if ((x1 - x0) * asp > 0.01 || y1 - y0 > 0.01) { const s = new Set(e.shift ? this.selected : []); for (const h of this.work) if (h.schwerpunkt[0] >= x0 && h.schwerpunkt[0] <= x1 && h.schwerpunkt[1] >= y0 && h.schwerpunkt[1] <= y1) s.add(h.id); this.selected = s; }
          this.bump();
        }
      }
    } else if (this.tool === 'vertex') {
      const sg = this.single;
      if (e.type === 'down') {
        if (sg) {
          let bi = -1, bd = 0.02;
          sg.polygon.forEach((p, i) => { const d = Math.hypot((p[0] - e.u) * asp, p[1] - e.v); if (d < bd) { bd = d; bi = i; } });
          if (bi >= 0 && e.ctrl && sg.polygon.length > 3) { this.commit(updateHold(this.work, sg.id, { polygon: sg.polygon.filter((_, i) => i !== bi) })); return; }
          if (bi >= 0) { this.drag = { kind: 'vertex', id: sg.id, idx: bi, u0: e.u, v0: e.v, base: this.work }; return; }
        }
        const h = this.hit(e.u, e.v); this.selected = new Set(h ? [h.id] : []); this.bump();
      } else if (e.type === 'move' && this.drag?.kind === 'vertex') { this.work = moveVertex(this.drag.base, this.drag.id, this.drag.idx, [e.u, e.v]); this.bump(); }
      else if (e.type === 'up' && this.drag?.kind === 'vertex') { const d = this.drag; this.drag = null; this.commit(moveVertex(d.base, d.id, d.idx, [e.u, e.v])); }
      else if (e.type === 'dblclick' && sg) {
        let bi = -1, bd = 0.02;
        sg.polygon.forEach((p, i) => { const q = sg.polygon[(i + 1) % sg.polygon.length] as Vec2; const d = distToSegment([e.u * asp, e.v], [p[0] * asp, p[1]], [q[0] * asp, q[1]]); if (d < bd) { bd = d; bi = i; } });
        if (bi >= 0) { const poly = [...sg.polygon]; poly.splice(bi + 1, 0, [e.u, e.v]); this.commit(updateHold(this.work, sg.id, { polygon: poly })); }
      }
    } else if (this.tool === 'add') {
      if (e.type === 'down' && e.button === 0 && app.rect) {
        const existing = this.hit(e.u, e.v);
        if (existing) { this.selected = new Set([existing.id]); this.bump(); return; }
        const p = magicWand(app.rect, e.u, e.v, this.wandTol);
        if (!p) { app.toast('Hier wurde kein Griff erkannt. Tipp: „Zeichnen“ nutzen oder die Toleranz erhöhen.', 'warn'); return; }
        this.commit(addPolygon(this.work, p)); this.selected = new Set([this.work[this.work.length - 1]?.id ?? -1]);
      }
    } else if (this.tool === 'draw') {
      if (e.type === 'down' && e.button === 0) { this.drawPts = [...this.drawPts, [e.u, e.v]]; this.bump(); }
      else if (e.type === 'move') { this.splitB = [e.u, e.v]; }
      else if (e.type === 'dblclick') this.finishDraw();
    } else if (this.tool === 'split') {
      if (e.type === 'down') { this.splitA = [e.u, e.v]; this.splitB = [e.u, e.v]; }
      else if (e.type === 'move' && this.splitA) { this.splitB = [e.u, e.v]; }
      else if (e.type === 'up' && this.splitA && this.splitB) {
        const a = this.splitA, b = this.splitB; this.splitA = this.splitB = null;
        if (Math.hypot((a[0] - b[0]) * asp, a[1] - b[1]) < 0.01) return;
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const sg = this.single; const target = (sg && pointInPolygon(mid, sg.polygon) ? sg : null) ?? this.hit(mid[0], mid[1]) ?? this.hit(a[0], a[1]);
        if (!target) { app.toast('Die Trennlinie muss über einem Griff liegen.', 'warn'); return; }
        const next = splitHold(this.work, target.id, a, b);
        if (next.length === this.work.length) { app.toast('Die Linie schneidet den Griff nicht.', 'warn'); return; }
        this.commit(next);
      }
    }
  };
  finishDraw(): void { if (this.drawPts.length >= 3) { this.commit(addPolygon(this.work, this.drawPts)); this.selected = new Set([this.work[this.work.length - 1]?.id ?? -1]); } this.drawPts = []; this.splitB = null; this.bump(); }

  overlay = (ctx: CanvasRenderingContext2D, tf: (u: number, v: number) => [number, number]): void => {
    void this.version;
    if (this.showSuspicious) {
      const ids = new Set(this.suspicious()); ctx.save(); ctx.strokeStyle = color.warn; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      for (const h of this.work) if (ids.has(h.id) && !this.selected.has(h.id)) { const [x, y] = tf(h.schwerpunkt[0], h.schwerpunkt[1]); const [bx0, by0] = tf(h.bbox[0], h.bbox[1]), [bx1, by1] = tf(h.bbox[2], h.bbox[3]); ctx.beginPath(); ctx.arc(x, y, Math.max(10, Math.hypot(bx1 - bx0, by1 - by0) / 2 + 4), 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    const sg = this.single;
    if (this.tool === 'vertex' && sg) for (const p of sg.polygon) { const [x, y] = tf(p[0], p[1]); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = color.warn; ctx.fill(); ctx.strokeStyle = '#05070a'; ctx.stroke(); }
    if (this.tool === 'draw' && this.drawPts.length) { ctx.strokeStyle = color.accent; ctx.lineWidth = 2; ctx.beginPath(); this.drawPts.forEach((p, i) => { const [x, y] = tf(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); if (this.splitB) { const [x, y] = tf(this.splitB[0], this.splitB[1]); ctx.lineTo(x, y); } ctx.stroke(); }
    if (this.tool === 'split' && this.splitA && this.splitB) { const [x1, y1] = tf(this.splitA[0], this.splitA[1]), [x2, y2] = tf(this.splitB[0], this.splitB[1]); ctx.strokeStyle = color.error; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
    if (this.marquee) { const m = this.marquee; const [x0, y0] = tf(Math.min(m.u0, m.u1), Math.min(m.v0, m.v1)), [x1, y1] = tf(Math.max(m.u0, m.u1), Math.max(m.v0, m.v1)); ctx.save(); ctx.fillStyle = 'rgba(124,196,255,.12)'; ctx.strokeStyle = color.accent; ctx.setLineDash([5, 3]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore(); }
  };

  /** Tastenkürzel; gibt true zurück, wenn behandelt. */
  key(e: KeyboardEvent): boolean {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) this.redo(); else this.undo(); return true; }
    if (mod && k === 'y') { e.preventDefault(); this.redo(); return true; }
    if (mod && k === 'a') { e.preventDefault(); this.selectAll(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (this.selected.size) { e.preventDefault(); this.deleteSelected(); return true; } return false; }
    if (e.key === 'Enter' && this.tool === 'draw') { this.finishDraw(); return true; }
    if (e.key === 'Escape') { this.drawPts = []; this.splitA = this.splitB = null; this.marquee = null; this.selected = new Set(); this.bump(); return true; }
    if (k === 'm' && !mod) { this.mergeSelected(); return true; }
    const map: Record<string, Tool> = { v: 'select', a: 'add', p: 'draw', t: 'split', e: 'vertex' };
    if (!mod && map[k]) { this.setTool(map[k] as Tool); return true; }
    return false;
  }

  exportJson(): void {
    const doc = { schemaVersion: 1, typ: 'Holds', wandId: app.profile?.id ?? '', erstellt: new Date().toISOString(), griffe: this.work };
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' })); a.download = 'holds.json'; a.click();
  }
  async importFile(f: File): Promise<void> { await app.importHoldsFile(f); this.load(); }
  centroidOf(h: Hold): Vec2 { return centroid(h.polygon); }
}

export const editor = new EditorController();
