<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../../app/state.svelte';
  import WallMap from '../WallMap.svelte';
  import type { RenderState, WallPointer } from '../wallTypes';
  import type { Hold, Route, SessionDoc } from '../../core/schemas';
  import { LIMBS } from '../../core/schemas';
  import { ReplayEngine, decodeChunk, N_KP } from '../../session/recorder';
  import { compareToRoute, dynamicShare, holdUsage, leftRight, moveSequence, pathLengthCm, pauses, segmentAttempts, seriesFromReplay, stat, timePerMove } from '../../session/analysis';
  import { eventsCsv, projectZip, timeseriesCsv } from '../../export/exporters';
  import { pointInPolygon } from '../../geometry/polygon';
  import { limbColor } from '../../design/tokens';
  import { t } from '../../i18n';

  let cur = $state<SessionDoc | null>(null); let rp = $state<ReplayEngine | null>(null); let pos = $state(0); let playing = $state(false); let speed = $state(1);
  let heat = $state(false); let routeId = $state(''); let editRoute = $state(false); let routeName = $state('Neue Route'); let draftRole = $state<'start' | 'hand' | 'fuss' | 'top'>('hand');
  let draft = $state<Route['griffe']>([]); let ghostId = $state(''); let ghostRp = $state<ReplayEngine | null>(null); let map = $state<ReturnType<typeof WallMap>>(); let raf = 0; let last = 0; let version = $state(0);
  const cm = $derived(app.profile?.hoehe_cm ?? (app.profile?.breite_cm ? app.profile.breite_cm / app.profile.aspekt : 240));

  async function loadReplay(s: SessionDoc): Promise<ReplayEngine> {
    const chunks = [];
    for (const id of s.chunkIds) { const b = await app.store.getChunk(id); if (b) chunks.push(decodeChunk(b)); }
    return new ReplayEngine(chunks);
  }
  async function open(s: SessionDoc): Promise<void> { playing = false; cur = s; rp = await loadReplay(s); pos = 0; heat = false; ghostId = ''; ghostRp = null; if (rp.length === 0) app.toast('Diese Session enthält keine Zeitreihe.', 'warn'); }
  async function chooseGhost(): Promise<void> { const g = app.sessions.find((x) => x.id === ghostId); ghostRp = g ? await loadReplay(g) : null; }
  function loop(now: number): void { raf = requestAnimationFrame(loop); if (!rp || !playing) { last = now; return; } rp.playing = true; rp.speed = speed; rp.seek(pos); rp.tick(now - last); pos = rp.position; if (!rp.playing) playing = false; last = now; }
  raf = requestAnimationFrame(loop); onDestroy(() => cancelAnimationFrame(raf));

  const frameState = (): RenderState => {
    const f = rp?.frameAt(pos); if (!f) return { limbs: {}, skeleton: null };
    const limbs: RenderState['limbs'] = {};
    LIMBS.forEach((l, i) => { const h = f.hold[i] as number; if (h >= 0) limbs[l] = { holdId: h, confidence: (f.conf[i] as number) / 100, state: 'HOLDING', evidence: 'gesehen' }; });
    const sk = Array.from({ length: N_KP }, (_, i) => { const u = f.kp[i * 3] as number; return Number.isFinite(u) ? { u, v: f.kp[i * 3 + 1] as number, c: f.kp[i * 3 + 2] as number } : null; });
    return { limbs, skeleton: sk };
  };
  function overlay(ctx: CanvasRenderingContext2D, tf: (u: number, v: number) => [number, number]): void {
    const g = ghostRp?.frameAt(pos); if (!g) return;
    ctx.save(); ctx.strokeStyle = 'rgba(200,200,255,.45)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    for (const [a, b] of [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]] as [number, number][]) {
      const ua = g.kp[a * 3] as number, ub = g.kp[b * 3] as number; if (!Number.isFinite(ua) || !Number.isFinite(ub)) continue;
      const [x1, y1] = tf(ua, g.kp[a * 3 + 1] as number), [x2, y2] = tf(ub, g.kp[b * 3 + 1] as number); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.restore();
  }

  const events = $derived(cur?.events ?? []);
  const moves = $derived(moveSequence(events));
  const usage = $derived(holdUsage(events, cur?.dauer_ms ?? 0));
  const lr = $derived(leftRight(usage));
  const ser = $derived(rp && app.profile ? seriesFromReplay(rp, app.profile.aspekt, cm) : null);
  const route = $derived(app.routes.find((r) => r.id === routeId) ?? null);
  const attempts = $derived(route && cur ? segmentAttempts(events, route, cur.dauer_ms) : []);
  const cmp = $derived(route ? compareToRoute(moves, route) : null);
  const maxUse = $derived(usage[0]?.ms ?? 1);
  const fills = $derived(heat ? new Map<number, string>(usage.map((u) => [u.holdId, `rgba(255,${Math.round(200 - 160 * (u.ms / maxUse))},60,${0.2 + 0.6 * (u.ms / maxUse)})`])) : routeFill(draft, route));
  function routeFill(d: Route['griffe'], r: Route | null): Map<number, string> | undefined {
    const src = editRoute ? d : r?.griffe; if (!src?.length) return undefined;
    const cmap: Record<string, string> = { start: 'rgba(61,220,151,.4)', hand: 'rgba(124,196,255,.3)', fuss: 'rgba(204,121,167,.3)', top: 'rgba(255,200,87,.45)' };
    return new Map(src.map((g) => [g.holdId, cmap[g.rolle] as string]));
  }
  function onwall(e: WallPointer): void {
    if (!editRoute || e.type !== 'down') return; const h = app.holds.find((x: Hold) => pointInPolygon([e.u, e.v], x.polygon)); if (!h) return;
    const i = draft.findIndex((g) => g.holdId === h.id);
    draft = i >= 0 ? draft.filter((_, k) => k !== i) : [...draft, { holdId: h.id, rolle: draftRole, reihenfolge: draft.length + 1 }]; version++;
  }
  async function saveRoute(): Promise<void> { if (!app.profile || !draft.length) return; const r: Route = { schemaVersion: 1, typ: 'Route', id: crypto.randomUUID(), wandId: app.profile.id, name: routeName || 'Route', griffe: draft, zugfolge: [] }; await app.store.putRoute(r); app.routes = await app.store.listRoutes(app.profile.id); routeId = r.id; editRoute = false; draft = []; app.toast('Route gespeichert.', 'ok'); }
  async function delRoute(): Promise<void> { if (!route || !confirm('Route löschen?')) return; await app.store.deleteRoute(route.id); app.routes = await app.store.listRoutes(app.profile!.id); routeId = ''; }
  async function delSession(s: SessionDoc): Promise<void> { if (!confirm('Session unwiderruflich löschen?')) return; await app.store.deleteSession(s.id); app.sessions = await app.store.listSessions(app.profile?.id); if (cur?.id === s.id) { cur = null; rp = null; } }

  const dl = (name: string, data: BlobPart | Uint8Array, type: string): void => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data as BlobPart], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  function exportJson(): void { if (cur) dl(`session-${cur.id.slice(0, 8)}.json`, JSON.stringify(cur, null, 1), 'application/json'); }
  function exportEvents(): void { if (cur) dl(`ereignisse-${cur.id.slice(0, 8)}.csv`, eventsCsv(cur.events), 'text/csv'); }
  function exportSeries(): void { if (rp && cur) dl(`zeitreihe-${cur.id.slice(0, 8)}.csv`, timeseriesCsv(rp), 'text/csv'); }
  async function exportZip(): Promise<void> {
    if (!app.profile) return; const p = app.profile, blobs: Record<string, Uint8Array> = {}, chunks: Record<string, Uint8Array> = {};
    for (const id of [p.referenzfoto.blobId, p.referenz_entzerrt.blobId]) { const b = await app.store.getBlob(id); if (b) blobs[id.replace(/[:]/g, '_')] = b.data; }
    for (const s of app.sessions) for (const c of s.chunkIds) { const b = await app.store.getChunk(c); if (b) chunks[c] = b; }
    dl(`climbvision-${p.name.replace(/\W+/g, '_')}.zip`, projectZip({ profile: p, holds: { schemaVersion: 1, typ: 'Holds', wandId: p.id, erstellt: new Date().toISOString(), griffe: $state.snapshot(app.holds) as Hold[] }, routes: $state.snapshot(app.routes) as Route[], sessions: $state.snapshot(app.sessions) as SessionDoc[], blobs, chunks }), 'application/zip');
  }
  async function screenshot(): Promise<void> { const b = await map?.toPng(); if (b) dl('wandkarte.png', b, 'image/png'); }
  /** Overlay-Video: Replay in Echtzeit abspielen und den Wandkarten-Canvas mit MediaRecorder aufnehmen (Skelett + leuchtende Griffe). */
  async function exportVideo(): Promise<void> {
    const c = map?.element(); if (!c || !rp || !(c as HTMLCanvasElement & { captureStream?: (f: number) => MediaStream }).captureStream) return app.toast('Videoexport wird von diesem Browser nicht unterstützt.', 'warn');
    const stream = (c as HTMLCanvasElement & { captureStream: (f: number) => MediaStream }).captureStream(30); const rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); const parts: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); }; pos = 0; speed = 1; rec.start(500); playing = true;
    app.toast('Overlay-Video wird in Echtzeit aufgenommen …', 'info', 4000);
    await new Promise<void>((r) => { const iv = setInterval(() => { if (!playing) { clearInterval(iv); r(); } }, 200); });
    await new Promise<void>((r) => { rec.onstop = () => r(); rec.stop(); }); dl('overlay.webm', new Blob(parts, { type: 'video/webm' }), 'video/webm');
  }
  const fmt = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
  const num = (x: number, d = 0): string => (Number.isFinite(x) ? x.toFixed(d) : '–');
</script>

<div class="sess">
  <aside class="list panel">
    <h3>Sessions</h3>
    {#if app.sessions.length === 0}<div class="empty">{t('empty.noSessions')}</div>{/if}
    {#each app.sessions as s (s.id)}
      <div class="item" class:on={cur?.id === s.id}>
        <button class="grow open" onclick={() => open(s)}><b>{new Date(s.start).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</b><br /><span class="muted">{fmt(s.dauer_ms)} · {s.events.length} Ereignisse</span></button>
        <button class="sm danger" onclick={() => delSession(s)} aria-label="Session löschen">✕</button>
      </div>
    {/each}
    <h3 style="margin-top:16px">Routen</h3>
    {#if app.routes.length === 0 && !editRoute}<div class="muted">{t('empty.noRoutes')}</div>{/if}
    <select bind:value={routeId} aria-label="Route wählen"><option value="">– keine –</option>{#each app.routes as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select>
    <div class="row" style="margin-top:6px">{#if !editRoute}<button class="sm" onclick={() => { editRoute = true; draft = []; }}>Neue Route</button>{#if route}<button class="sm danger" onclick={delRoute}>Löschen</button>{/if}
      {:else}<input type="text" bind:value={routeName} aria-label="Routenname" /><select bind:value={draftRole} aria-label="Rolle"><option value="start">Start</option><option value="hand">Hand</option><option value="fuss">Fuß</option><option value="top">Top</option></select>
        <button class="sm primary" onclick={saveRoute} disabled={!draft.length}>Speichern</button><button class="sm" onclick={() => { editRoute = false; draft = []; }}>Abbrechen</button><div class="muted">Griffe in der Karte anklicken ({draft.length} gewählt).</div>{/if}</div>
  </aside>

  <section class="main">
    {#if !app.profile}<div class="empty">{t('empty.noProfile')}</div>
    {:else}
      <div class="mapw"><WallMap bind:this={map} holds={app.holds} aspekt={app.profile.aspekt} background={app.rectBitmap} getState={frameState} showIds={app.settings.showIds} showConf={false} {overlay} {onwall} fillColors={fills} staticVersion={version} swap={app.settings.swapLeftRight} /></div>
      {#if rp && cur}
        <div class="ctl panel">
          <button onclick={() => { if (!playing && pos >= rp!.durationMs) pos = 0; playing = !playing; }}>{playing ? '❚❚ Pause' : '▶ Abspielen'}</button>
          <button class="sm" onclick={() => { rp!.seek(pos); const f = rp!.stepFrame(-1); if (f) pos = f.t; }}>◀︎ Bild</button><button class="sm" onclick={() => { rp!.seek(pos); const f = rp!.stepFrame(1); if (f) pos = f.t; }}>Bild ▶︎</button>
          <input class="grow" type="range" min="0" max={rp.durationMs} step="1" bind:value={pos} oninput={() => (playing = false)} aria-label="Zeitleiste" /><span class="mono">{fmt(pos)} / {fmt(rp.durationMs)}</span>
          <select bind:value={speed} aria-label="Geschwindigkeit"><option value={0.1}>0,1×</option><option value={0.25}>0,25×</option><option value={0.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
        </div>
      {:else}<div class="empty">Session links auswählen.</div>{/if}
    {/if}
  </section>

  <aside class="ana panel">
    <h3>Auswertung</h3>
    {#if cur && rp}
      <div class="muted">Hinweis: Winkel, Spannweiten und Schwerpunkt sind <b>2D-Näherungen</b> in der Wandebene.</div>
      <div class="kv"><span>Dauer</span><b>{fmt(cur.dauer_ms)}</b><span>Züge</span><b>{moves.length}</b><span>Ø Zeit/Zug</span><b>{num(stat(timePerMove(moves)).mean / 1000, 1)} s</b><span>Pausen ≥ 2 s</span><b>{pauses(moves).length}</b>
        {#if ser}<span>Hüftbahn</span><b>{num(pathLengthCm(ser.hip, cm) / 100, 1)} m</b><span>Spannweite max/Ø</span><b>{num(stat(ser.span).max)} / {num(stat(ser.span).mean)} cm</b><span>Ellbogen L (min–max)</span><b>{num(stat(ser.elbowL).min)}–{num(stat(ser.elbowL).max)}°</b><span>Ellbogen R</span><b>{num(stat(ser.elbowR).min)}–{num(stat(ser.elbowR).max)}°</b><span>Knie L</span><b>{num(stat(ser.kneeL).min)}–{num(stat(ser.kneeL).max)}°</b><span>Knie R</span><b>{num(stat(ser.kneeR).min)}–{num(stat(ser.kneeR).max)}°</b><span>Hüfte L / R (Ø)</span><b>{num(stat(ser.hipAngleL).mean)} / {num(stat(ser.hipAngleR).mean)}°</b>
          <span>dynamisch / statisch</span><b>{num(dynamicShare(ser, cm).dynamisch * 100)} % / {num(dynamicShare(ser, cm).statisch * 100)} %</b>{/if}
        <span>Links / Rechts</span><b>{num(lr.anteilLinks * 100)} % / {num((1 - lr.anteilLinks) * 100)} %</b></div>
      <label class="inl"><input type="checkbox" bind:checked={heat} /> Griff-Nutzungs-Heatmap</label>
      <h3 style="margin-top:12px">Meistgenutzte Griffe</h3>
      <ol class="top">{#each usage.slice(0, 8) as u (u.holdId)}<li><b>#{u.holdId}</b> {(u.ms / 1000).toFixed(1)} s {#each LIMBS as l (l)}{#if u.limbs[l] > 0}<span class="dot" style:background={limbColor[l]} title={l}></span>{/if}{/each}</li>{/each}</ol>
      {#if route}<h3 style="margin-top:12px">Soll/Ist: {route.name}</h3>
        {#if cmp}<div>{cmp.getroffen} von {cmp.soll} Zügen ({num(cmp.anteil * 100)} %){#if cmp.zusaetzlich.length} · zusätzlich: {cmp.zusaetzlich.join(', ')}{/if}</div>{/if}
        <h3 style="margin-top:8px">Versuche</h3>{#each attempts as a, i (i)}<div>#{i + 1}: {fmt(a.startMs)}–{fmt(a.endMs)} · {a.ende} · {a.zuege} Züge</div>{:else}<div class="muted">Kein Versuch erkannt.</div>{/each}{/if}
      <h3 style="margin-top:12px">Vergleich (Ghost)</h3>
      <select bind:value={ghostId} onchange={chooseGhost} aria-label="Ghost-Session"><option value="">– kein Ghost –</option>{#each app.sessions.filter((x) => x.id !== cur?.id) as s (s.id)}<option value={s.id}>{new Date(s.start).toLocaleString('de-DE')}</option>{/each}</select>
      <h3 style="margin-top:12px">Export</h3>
      <div class="row"><button class="sm" onclick={exportJson}>JSON</button><button class="sm" onclick={exportEvents}>Ereignisse (CSV)</button><button class="sm" onclick={exportSeries}>Zeitreihe (CSV)</button><button class="sm" onclick={screenshot}>Screenshot</button><button class="sm" onclick={exportVideo}>Overlay-Video</button><button class="sm" onclick={exportZip}>Projekt (ZIP)</button></div>
    {:else}<div class="empty">Keine Session geöffnet.</div>{/if}
  </aside>
</div>

<style>
  .sess { display: grid; grid-template-columns: 260px 1fr 330px; gap: 12px; height: 100%; padding: 12px; min-height: 0; } .list, .ana { overflow: auto; } .main { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
  .mapw { flex: 1; min-height: 0; border: 1px solid var(--c-border); border-radius: var(--radius-2); overflow: hidden; background: #05070a; } .ctl { display: flex; gap: 8px; align-items: center; padding: 8px; flex-wrap: wrap; }
  .item { display: flex; gap: 4px; margin-bottom: 6px; } .item.on .open { border-color: var(--c-accent); } .open { text-align: left; padding: 6px 10px; }
  .kv { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; margin: 8px 0; } .kv span { color: var(--c-textMuted); } .top { margin: 0; padding-left: 20px; } .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-left: 4px; }
  .inl { display: inline-flex; gap: 6px; align-items: center; margin: 0; color: var(--c-text); font-size: 14px; }
  @media (max-width: 1100px) { .sess { grid-template-columns: 1fr; } .mapw { min-height: 50vh; } }
</style>
