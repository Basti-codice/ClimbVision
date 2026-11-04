<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../../app/state.svelte';
  import WallMap from '../WallMap.svelte';
  import type { WallPointer } from '../wallTypes';
  import type { Hold } from '../../core/schemas';
  import { History, addPolygon, autoNumber, deleteHolds, filterBySize, makeHold, medianArea, mergeHolds, moveHold, moveVertex, splitHold, updateHold } from '../../holds/editor';
  import { magicWand, type SegmentOptions } from '../../holds/segment';
  import { distToSegment, pointInPolygon, signedDistance, area } from '../../geometry/polygon';
  import { resizeRgba } from '../../image/raster';
  import type { Vec2 } from '../../geometry/homography';
  import { color } from '../../design/tokens';
  import { t } from '../../i18n';

  type Tool = 'select' | 'vertex' | 'draw' | 'split' | 'magic';
  let work = $state<Hold[]>([]);
  let hist = $state.raw(new History<Hold[]>([]));
  let tool = $state<Tool>('select');
  let selected = $state<Set<number>>(new Set());
  let version = $state(0);
  let map = $state<ReturnType<typeof WallMap>>();
  let drawPts: Vec2[] = []; let splitA: Vec2 | null = null, splitB: Vec2 | null = null;
  let drag: { kind: 'hold' | 'vertex'; id: number; idx: number; u0: number; v0: number; base: Hold[] } | null = null;
  let progress = $state(0); let step = $state(''); let scanning = $state(false); let cancel: (() => void) | null = null;
  let preset = $state<'standard' | 'klein' | 'dicht'>('standard'); let polarity = $state<'auto' | 'hell' | 'dunkel'>('auto');
  let wandTol = $state(28); let minRel = $state(0.2); let maxRel = $state(6); let showIds = $state(true); let saveTimer: number | undefined; let lastInfo = $state('');

  $effect(() => { if (app.profile) { work = app.holds; hist = new History<Hold[]>(app.holds); selected = new Set(); version++; } });
  onDestroy(() => { cancel?.(); clearTimeout(saveTimer); void app.setHolds($state.snapshot(work) as Hold[]); });

  const PRESETS: Record<string, Partial<SegmentOptions>> = { standard: {}, klein: { minAreaFrac: 0.00003, localContrast: 4, openRadius: 1 }, dicht: { splitRel: 0.18, splitMinAbs: 1.0, openRadius: 2 } };
  const canUndo = $derived.by(() => { void version; return hist.canUndo; });
  const canRedo = $derived.by(() => { void version; return hist.canRedo; });
  const sel = $derived([...selected]);
  const single = $derived(sel.length === 1 ? work.find((h) => h.id === sel[0]) ?? null : null);
  const med = $derived(medianArea(work));

  function commit(next: Hold[], keepSel = true): void {
    hist.push(next); work = next; version++; if (!keepSel) selected = new Set();
    clearTimeout(saveTimer); saveTimer = window.setTimeout(() => void app.setHolds($state.snapshot(work) as Hold[]), 700);
  }
  function undo(): void { if (hist.undo()) { work = hist.present; selected = new Set(); version++; void app.setHolds(work); } }
  function redo(): void { if (hist.redo()) { work = hist.present; selected = new Set(); version++; void app.setHolds(work); } }

  async function scan(): Promise<void> {
    if (!app.rect || !app.profile) return;
    if (work.some((h) => h.quelle === 'manuell') && !confirm('Es gibt manuell bearbeitete Griffe. Der Scan ersetzt ALLE Griffe (Rückgängig mit Strg+Z möglich). Fortfahren?')) return;
    scanning = true; progress = 0; step = 'Starte …';
    try {
      const k = Math.min(1, 1200 / Math.max(app.rect.width, app.rect.height));
      const img = k < 1 ? resizeRgba(app.rect, Math.round(app.rect.width * k), Math.round(app.rect.height * k)) : app.rect;
      const job = app.cv.segment(img, { ...PRESETS[preset], polarity }, (f, s) => { progress = f; step = s; });
      cancel = job.cancel; const r = await job.promise; cancel = null;
      const polys = r.polygons.map((p) => p);
      const med0 = polys.length ? [...polys.map((p) => area(p))].sort((a, b) => a - b)[polys.length >> 1] ?? 0 : 0;
      const holds = autoNumber(polys.map((p, i) => makeHold(i + 1, p, 'auto', med0)));
      commit(holds, false); lastInfo = `${holds.length} Griffe in ${(r.ms / 1000).toFixed(1)} s erkannt (Polarität: ${r.polaritaet}).`;
      app.toast(lastInfo + ' Bitte im Editor prüfen und korrigieren.', 'ok');
    } catch (e) { if (scanning) app.error(e, 'Scan fehlgeschlagen: '); } finally { scanning = false; cancel = null; }
  }
  function abort(): void { cancel?.(); app.cv.dispose(); scanning = false; app.toast('Scan abgebrochen.', 'warn'); }

  function hit(u: number, v: number): Hold | null {
    const iso: Vec2 = [u * (app.profile?.aspekt ?? 1), v];
    for (let i = work.length - 1; i >= 0; i--) { const h = work[i] as Hold; if (pointInPolygon([u, v], h.polygon)) return h; }
    let best: Hold | null = null, bd = 0.012;
    for (const h of work) { const d = signedDistance(iso, h.polygon.map((p) => [p[0] * (app.profile?.aspekt ?? 1), p[1]] as Vec2)); if (d < bd) { bd = d; best = h; } }
    return best;
  }
  const px = (zoom: number): number => 8 / (Math.max(1, zoom) * 900); // ~8 CSS-px in Wandkoordinaten (grob)

  function onwall(e: WallPointer): void {
    const asp = app.profile?.aspekt ?? 1;
    if (tool === 'select') {
      if (e.type === 'down' && e.button === 0) {
        const h = hit(e.u, e.v);
        if (!h) { if (!e.shift) selected = new Set(); return; }
        const s = new Set(selected); if (e.shift) { if (s.has(h.id)) s.delete(h.id); else s.add(h.id); } else if (!s.has(h.id)) { s.clear(); s.add(h.id); }
        selected = s; drag = { kind: 'hold', id: h.id, idx: 0, u0: e.u, v0: e.v, base: work };
      } else if (e.type === 'move' && drag?.kind === 'hold') {
        let next = drag.base; for (const id of selected) next = moveHold(next, id, e.u - drag.u0, e.v - drag.v0); work = next; version++;
      } else if (e.type === 'up' && drag?.kind === 'hold') {
        const d = drag; drag = null;
        if (work !== d.base) { let n = d.base; for (const id of selected) n = moveHold(n, id, e.u - d.u0, e.v - d.v0); work = d.base; commit(n); }
      }
    } else if (tool === 'vertex') {
      if (!single) { if (e.type === 'down') { const h = hit(e.u, e.v); if (h) selected = new Set([h.id]); } return; }
      if (e.type === 'down') {
        let bi = -1, bd = px(e.zoom) * 2.2; single.polygon.forEach((p, i) => { const d = Math.hypot((p[0] - e.u) * asp, p[1] - e.v); if (d < bd * 1) { bd = d; bi = i; } });
        if (bi >= 0 && e.ctrl && single.polygon.length > 3) { commit(updateHold(work, single.id, { polygon: single.polygon.filter((_, i) => i !== bi) })); return; }
        if (bi >= 0) drag = { kind: 'vertex', id: single.id, idx: bi, u0: e.u, v0: e.v, base: work };
        else { const h = hit(e.u, e.v); selected = new Set(h ? [h.id] : []); }
      } else if (e.type === 'move' && drag?.kind === 'vertex') { work = moveVertex(drag.base, drag.id, drag.idx, [e.u, e.v]); version++; }
      else if (e.type === 'up' && drag?.kind === 'vertex') { const d = drag; drag = null; commit(moveVertex(d.base, d.id, d.idx, [e.u, e.v])); }
      else if (e.type === 'dblclick') { // Eckpunkt auf der nächsten Kante einfügen
        let bi = -1, bd = 0.02; single.polygon.forEach((p, i) => { const q = single.polygon[(i + 1) % single.polygon.length] as Vec2; const d = distToSegment([e.u * asp, e.v], [p[0] * asp, p[1]], [q[0] * asp, q[1]]); if (d < bd) { bd = d; bi = i; } });
        if (bi >= 0) { const poly = [...single.polygon]; poly.splice(bi + 1, 0, [e.u, e.v]); commit(updateHold(work, single.id, { polygon: poly })); }
      }
    } else if (tool === 'draw') {
      if (e.type === 'down' && e.button === 0) { drawPts = [...drawPts, [e.u, e.v]]; version++; }
      else if (e.type === 'move') { splitB = [e.u, e.v]; }
      else if (e.type === 'dblclick') finishDraw();
    } else if (tool === 'split') {
      if (e.type === 'down') { splitA = [e.u, e.v]; splitB = [e.u, e.v]; }
      else if (e.type === 'move' && splitA) splitB = [e.u, e.v];
      else if (e.type === 'up' && splitA && splitB) {
        const a = splitA, b = splitB; splitA = splitB = null;
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01) return;
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const target = (single && pointInPolygon(mid, single.polygon) ? single : null) ?? hit(mid[0], mid[1]) ?? hit(a[0], a[1]);
        if (!target) return app.toast('Die Trennlinie muss über einem Griff liegen.', 'warn');
        // Gerade bleibt unter der affinen Abbildung uv↔iso eine Gerade → direkt in uv teilen
        const next2 = splitHold(work, target.id, a, b);
        if (next2.length === work.length) return app.toast('Die Linie schneidet den Griff nicht.', 'warn');
        commit(next2);
      }
    } else if (tool === 'magic') {
      if (e.type === 'down' && e.button === 0 && app.rect) {
        const p = magicWand(app.rect, e.u, e.v, wandTol);
        if (!p) return app.toast('Zauberstab: kein Griff erkannt. Toleranz ändern oder an anderer Stelle klicken.', 'warn');
        commit(addPolygon(work, p)); selected = new Set([work[work.length - 1]?.id ?? -1]);
      }
    }
  }
  function finishDraw(): void { if (drawPts.length >= 3) { commit(addPolygon(work, drawPts)); selected = new Set([work[work.length - 1]?.id ?? -1]); } drawPts = []; splitB = null; version++; }

  function overlay(ctx: CanvasRenderingContext2D, tf: (u: number, v: number) => [number, number]): void {
    if (tool === 'vertex' && single) { for (const p of single.polygon) { const [x, y] = tf(p[0], p[1]); ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = color.warn; ctx.fill(); ctx.strokeStyle = '#05070a'; ctx.stroke(); } }
    if (tool === 'draw' && drawPts.length) { ctx.strokeStyle = color.accent; ctx.lineWidth = 2; ctx.beginPath(); drawPts.forEach((p, i) => { const [x, y] = tf(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); if (splitB) { const [x, y] = tf(splitB[0], splitB[1]); ctx.lineTo(x, y); } ctx.stroke(); drawPts.forEach((p) => { const [x, y] = tf(p[0], p[1]); ctx.fillStyle = color.accent; ctx.fillRect(x - 3, y - 3, 6, 6); }); }
    if (tool === 'split' && splitA && splitB) { const [x1, y1] = tf(splitA[0], splitA[1]), [x2, y2] = tf(splitB[0], splitB[1]); ctx.strokeStyle = color.error; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); }
  }

  function key(e: KeyboardEvent): void {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selected.size) { e.preventDefault(); commit(deleteHolds(work, selected), false); } }
    else if (e.key === 'Enter' && tool === 'draw') finishDraw();
    else if (e.key === 'Escape') { drawPts = []; splitA = splitB = null; selected = new Set(); version++; }
    else if (e.key.toLowerCase() === 'm' && selected.size > 1) commit(mergeHolds(work, sel));
    else if (!mod) { const m: Record<string, Tool> = { v: 'select', e: 'vertex', p: 'draw', t: 'split', w: 'magic' }; const t = m[e.key.toLowerCase()]; if (t) { tool = t; drawPts = []; } }
  }
  function exportHolds(): void { const doc = { schemaVersion: 1, typ: 'Holds', wandId: app.profile?.id ?? '', erstellt: new Date().toISOString(), griffe: $state.snapshot(work) }; const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' })); a.download = 'holds.json'; a.click(); }
  async function importHolds(e: Event): Promise<void> { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { await app.importHoldsFile(f); work = app.holds; hist = new History(app.holds); version++; } catch (err) { app.error(err); } }
  function applyFilter(): void { const n = filterBySize(work, minRel, maxRel); if (n.length === work.length) return app.toast('Kein Griff liegt außerhalb dieses Größenbereichs.', 'info'); if (confirm(`${work.length - n.length} Griffe entfernen?`)) commit(n, false); }
  const outside = $derived(work.filter((h) => h.relative_groesse < minRel || h.relative_groesse > maxRel).length);
  const fillColors = $derived(new Map<number, string>(work.filter((h) => h.relative_groesse < minRel || h.relative_groesse > maxRel).map((h) => [h.id, 'rgba(255,107,107,.35)'])));
</script>

<svelte:window onkeydown={key} />

{#if !app.profile}
  <div class="page"><div class="empty">{t('empty.noProfile')}</div></div>
{:else}
  <div class="scan">
    <div class="tools panel">
      <h3>Scan</h3>
      <label for="pre">Methode</label>
      <select id="pre" bind:value={preset}><option value="standard">Klassisch – Standard</option><option value="klein">Klassisch – kleine Griffe (empfindlicher)</option><option value="dicht">Klassisch – dichte Wand (stärker trennen)</option><option disabled>SAM-Verfeinerung (nicht enthalten)</option></select>
      <label for="pol">Griffe sind …</label>
      <select id="pol" bind:value={polarity}><option value="auto">automatisch erkennen</option><option value="hell">heller als die Wand</option><option value="dunkel">dunkler als die Wand</option></select>
      {#if scanning}<div class="row" style="margin-top:8px"><progress class="grow" value={progress} max="1"></progress><button class="sm" onclick={abort}>Abbrechen</button></div><div class="muted">{step}</div>
      {:else}<button class="primary" style="margin-top:8px;width:100%" onclick={scan} disabled={!app.rect}>Griffe automatisch erkennen</button>{/if}
      {#if lastInfo}<p class="muted">{lastInfo}</p>{/if}

      <h3 style="margin-top:16px">Werkzeuge</h3>
      <div class="grid2">
        {#each [['select', 'Auswählen/Verschieben', 'V'], ['vertex', 'Eckpunkte', 'E'], ['draw', 'Polygon zeichnen', 'P'], ['split', 'Teilen', 'T'], ['magic', 'Zauberstab', 'W']] as [k, l, c] (k)}
          <button class:on={tool === k} onclick={() => { tool = k as Tool; drawPts = []; }} title={`Taste ${c}`}>{l} <span class="kbd">{c}</span></button>{/each}
      </div>
      {#if tool === 'magic'}<label for="wt">Zauberstab-Toleranz: {wandTol}</label><input id="wt" type="range" min="8" max="90" bind:value={wandTol} />{/if}
      {#if tool === 'draw'}<p class="muted">Klicken setzt Eckpunkte, Doppelklick/Enter schließt das Polygon.</p>{/if}
      {#if tool === 'vertex'}<p class="muted">Punkte ziehen · Doppelklick auf Kante fügt Punkt ein · Strg+Klick löscht Punkt.</p>{/if}
      {#if tool === 'split'}<p class="muted">Linie über einen Griff ziehen.</p>{/if}
      <div class="row" style="margin-top:8px">
        <button class="sm" onclick={undo} disabled={!canUndo}>↶ Rückgängig</button><button class="sm" onclick={redo} disabled={!canRedo}>↷ Wiederholen</button>
        <button class="sm" disabled={sel.length < 2} onclick={() => commit(mergeHolds(work, sel))}>Zusammenführen <span class="kbd">M</span></button>
        <button class="sm danger" disabled={!sel.length} onclick={() => commit(deleteHolds(work, selected), false)}>Löschen <span class="kbd">Entf</span></button>
      </div>
      <div class="row" style="margin-top:8px"><button class="sm" onclick={() => commit(autoNumber(work), false)}>Auto-Nummerierung</button>
        <label class="inl"><input type="checkbox" bind:checked={showIds} /> IDs</label></div>

      <h3 style="margin-top:16px">Nach Größe filtern</h3>
      <label for="mn">Kleiner als {minRel.toFixed(2)}× Median</label><input id="mn" type="range" min="0" max="1" step="0.05" bind:value={minRel} />
      <label for="mx">Größer als {maxRel.toFixed(1)}× Median</label><input id="mx" type="range" min="1.5" max="12" step="0.5" bind:value={maxRel} />
      <div class="row"><span class="muted">{outside} Griffe außerhalb (rot markiert)</span><button class="sm" disabled={!outside} onclick={applyFilter}>Entfernen</button></div>

      <h3 style="margin-top:16px">Datei</h3>
      <div class="row"><button class="sm" onclick={exportHolds} disabled={!work.length}>holds.json exportieren</button><label class="fb sm">Importieren<input type="file" accept=".json,application/json" hidden onchange={importHolds} /></label></div>
    </div>

    <div class="mapw">
      {#if !work.length && !scanning}<div class="hint panel">{t('empty.noHolds')}</div>{/if}
      <WallMap bind:this={map} holds={work} aspekt={app.profile.aspekt} background={app.rectBitmap} backgroundDim={0.15} {showIds} selected={selected} {overlay} onwall={onwall} staticVersion={version}
        cursor={tool === 'select' ? 'default' : 'crosshair'} label="Griff-Editor" {fillColors} />
    </div>

    <div class="detail panel">
      <h3>Details</h3>
      <div class="muted">{work.length} Griffe · Median-Fläche {(med * 1e4).toFixed(1)}‱ · {work.filter((h) => h.quelle === 'manuell').length} manuell</div>
      {#if single}
        <div class="col" style="margin-top:8px">
          <div><b>Griff {single.id}</b> <span class="badge">{single.quelle}</span></div>
          <div class="muted">Relative Größe {single.relative_groesse.toFixed(2)} · Fläche {(single.flaeche * 1e4).toFixed(1)}‱</div>
          <div class="muted">Schwerpunkt ({single.schwerpunkt[0].toFixed(3)}, {single.schwerpunkt[1].toFixed(3)})</div>
          <label for="tid">Griff-ID</label><input id="tid" type="number" min="0" value={single.id} onchange={(e) => { const nid = Number((e.target as HTMLInputElement).value); if (work.some((h) => h.id === nid)) { app.toast('Diese ID ist schon vergeben.', 'warn'); (e.target as HTMLInputElement).value = String(single.id); return; } commit(work.map((h) => (h.id === single.id ? { ...h, id: nid } : h))); selected = new Set([nid]); }} />
          <label for="td">Tiefe (cm) – vergrößert die Kontakttoleranz</label><input id="td" type="number" min="0" step="0.5" value={single.tiefe_cm} onchange={(e) => commit(updateHold(work, single.id, { tiefe_cm: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) }))} />
          <label for="tg">Größe (cm), optional</label><input id="tg" type="number" min="0" step="0.5" value={single.groesse_cm ?? ''} onchange={(e) => { const v = Number((e.target as HTMLInputElement).value); commit(updateHold(work, single.id, v > 0 ? { groesse_cm: v } : {})); }} />
          <label for="tn">Notiz</label><input id="tn" type="text" value={single.notiz ?? ''} onchange={(e) => commit(updateHold(work, single.id, { notiz: (e.target as HTMLInputElement).value }))} />
        </div>
      {:else if sel.length > 1}<p>{sel.length} Griffe ausgewählt.</p>
      {:else}<p class="muted">Griff anklicken, um Details zu bearbeiten. Umschalt = Mehrfachauswahl. Rechte Maustaste/Alt+Ziehen verschiebt die Ansicht, Mausrad zoomt.</p>{/if}
      <button class="sm" style="margin-top:12px" onclick={() => map?.resetView()}>Ansicht zurücksetzen</button>
    </div>
  </div>
{/if}


<style>
  .scan { display: grid; grid-template-columns: 300px 1fr 300px; gap: 12px; height: 100%; padding: 12px; min-height: 0; }
  .tools, .detail { overflow: auto; } .mapw { position: relative; min-width: 0; min-height: 0; border: 1px solid var(--c-border); border-radius: var(--radius-2); overflow: hidden; background: #05070a; }
  .hint { position: absolute; z-index: 2; top: 12px; left: 50%; transform: translateX(-50%); max-width: 80%; } .page { padding: 24px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; } .grid2 button { min-height: 38px; padding: 0 8px; font-size: 13px; text-align: left; }
  .inl { display: inline-flex; gap: 6px; align-items: center; margin: 0; } .fb { display: inline-flex; align-items: center; padding: 0 12px; border: 1px solid var(--c-border); border-radius: var(--radius-2); cursor: pointer; margin: 0; color: var(--c-text); min-height: 34px; }
  @media (max-width: 1100px) { .scan { grid-template-columns: 1fr; grid-auto-rows: auto; } .mapw { min-height: 60vh; } }
</style>
