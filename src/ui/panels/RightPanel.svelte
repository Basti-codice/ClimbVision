<script lang="ts">
  import { app } from '../../app/state.svelte';
  import { live } from '../../app/live.svelte';
  import { editor } from '../../app/editor.svelte';
  import { replay } from '../../app/replay.svelte';
  import { t } from '../../i18n';
  import { LIMBS } from '../../core/schemas';
  import { limbColor } from '../../design/tokens';
  let minRel = $state(0.25); let open = $state({ perf: false, debug: false });
  const out = $derived(app.output); const st = $derived(app.stats);
  const conf = (c: number): string => `${Math.round(c * 100)}%`;
  const susp = $derived((void editor.version, editor.suspicious()));
  const smallN = $derived((void editor.version, editor.work.filter((h) => h.relative_groesse < minRel).length));
  const fmt = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  const num = (x: number | undefined, d = 0): string => (x !== undefined && Number.isFinite(x) ? x.toFixed(d) : '–');
  function check(dir: number): void { const c = editor.nextSuspicious(dir); if (c) app.stageApi?.focus(c[0], c[1], 3.2); }
  const sm = $derived(replay.summary);
</script>

{#if app.mode === 'live'}
  <section class="card"><h3>Kontakte</h3>
    {#each LIMBS as l (l)}{@const x = out?.contact.limbs[l]}
      <div class="row" style="border-left:4px solid {limbColor[l]};padding:5px 8px;margin-bottom:5px;background:var(--c-surface);border-radius:0 8px 8px 0;flex-wrap:nowrap">
        <b style="color:{limbColor[l]};width:26px">{l}</b><span class="grow muted" style="font-size:12px">{t('limb.' + l)}</span>
        {#if x && x.holdId !== null && x.state !== 'FREE'}<span class="mono">#{x.holdId}</span><span class="badge" class:warn={x.evidence === 'geschaetzt' || x.ambiguous}>{conf(x.confidence)}</span>{:else}<span class="muted">—</span>{/if}
      </div>
      {#if x?.ambiguous}<div class="muted" style="font-size:11px;margin:-2px 0 4px 8px">mehrdeutig · {x.candidates.slice(0, 2).map((c) => '#' + c.holdId).join(' / ')}</div>{/if}
    {/each}
    {#if !out}<p class="muted" style="font-size:12px;margin:6px 0 0">Starte die Erkennung, dann erscheinen hier die Kontakte.</p>{/if}
  </section>
  <section class="card"><h3>Status</h3>
    <div class="kv"><span>Person</span><b>{out ? t('track.' + out.status) : '—'}</b><span>Ausrichtung</span><b>{app.registration.ampel === 'gruen' ? 'in Ordnung' : app.registration.ampel}</b>
      <span>Kamera-Drift</span><b>{live.drift ? `${(live.drift.betrag * 100).toFixed(2)} % (${live.drift.status})` : '—'}</b><span>Datenaufnahme</span><b>{live.recording ? `${live.recFrames} Frames` : 'aus'}</b></div>
    {#if live.cmAssumed && live.running}<p class="muted" style="font-size:12px;margin:8px 0 0">Ohne Wandmaße wird für Toleranzen eine Wandhöhe von 2,4 m angenommen.</p>{/if}
  </section>
  <section class="card"><h3>Leistung <button class="sm" onclick={() => (open.perf = !open.perf)}>{open.perf ? 'weniger' : 'mehr'}</button></h3>
    <div class="kv mono"><span>Pose</span><b>{st ? st.poseHz.toFixed(1) : '—'} Hz</b><span>Render</span><b>{app.renderFps.toFixed(0)} FPS</b></div>
    {#if open.perf}<div class="kv mono" style="margin-top:4px"><span>Pose-Inferenz</span><b>{st ? st.poseMs.toFixed(0) : '—'} ms</b><span>Hand</span><b>{st ? `${st.handHz.toFixed(1)} Hz` : '—'}</b><span>Verzögerung</span><b>{st ? st.latencyMs.toFixed(0) : '—'} ms</b><span>Verworfen</span><b>{st ? st.dropped : '—'}</b><span>Abgewehrte Fremdzugriffe</span><b>{app.blockedExternal.count}</b></div>{/if}
  </section>
  {#if app.settings.debug}<section class="card"><h3>Debug</h3>{#each LIMBS as l (l)}{@const x = out?.contact.limbs[l]}<div class="mono" style="font-size:11px;margin:4px 0"><b>{l}</b> {x?.state ?? '—'} {#if x?.debug}· pos {x.debug.pos.toFixed(2)} v {x.debug.speed.toFixed(2)} dwell {x.debug.dwell.toFixed(2)}{/if}{#if x?.flags.length} [{x.flags.join(', ')}]{/if}{#each x?.candidates ?? [] as c (c.holdId)}<div>↳ #{c.holdId} {c.score.toFixed(2)} {Number.isFinite(c.distanceCm) ? c.distanceCm.toFixed(1) + ' cm' : ''}</div>{/each}</div>{/each}</section>{/if}

{:else if app.mode === 'edit'}
  <section class="card"><h3>Übersicht</h3>
    <div class="kv"><span>Griffe</span><b>{editor.work.length}</b><span>davon von Hand</span><b>{editor.work.filter((h) => h.quelle === 'manuell').length}</b><span>Typische Größe</span><b>{(editor.medianArea * 1e4).toFixed(1)}‱</b></div>
    {#if editor.work.length}
      <div class="row" style="margin-top:10px;flex-wrap:nowrap"><span class="grow" style="font-size:13px">{susp.length ? `${susp.length} Griffe prüfen` : 'Nichts Auffälliges'}</span>
        <button class="sm" disabled={!susp.length} onclick={() => check(-1)} aria-label="Vorheriger">◀</button><button class="sm" disabled={!susp.length} onclick={() => check(1)}>Prüfen ▶</button></div>
      <p class="muted" style="font-size:12px;margin:6px 0 0">Gelb gestrichelt: sehr klein, sehr groß oder unförmig – meist Reflexe, Kreide oder verschmolzene Griffe.</p>
    {/if}
  </section>
  {#if editor.single}{@const h = editor.single}
    <section class="card"><h3>Griff {h.id} <span class="badge">{h.quelle}</span></h3>
      <label for="gid">Nummer</label><input id="gid" type="number" min="0" value={h.id} onchange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (!editor.setId(h.id, v)) { app.toast('Diese Nummer ist schon vergeben.', 'warn'); (e.target as HTMLInputElement).value = String(h.id); } }} />
      <label for="gt">Tiefe in cm (vergrößert die Toleranz)</label><input id="gt" type="number" min="0" step="0.5" value={h.tiefe_cm} onchange={(e) => editor.patch(h.id, { tiefe_cm: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} />
      <label for="gn">Notiz</label><input id="gn" type="text" value={h.notiz ?? ''} onchange={(e) => editor.patch(h.id, { notiz: (e.target as HTMLInputElement).value })} />
    </section>
  {:else if editor.selected.size > 1}
    <section class="card"><h3>{editor.selected.size} Griffe gewählt</h3><div class="row"><button class="sm" onclick={() => editor.mergeSelected()}>Zusammenführen</button><button class="sm danger" onclick={() => editor.deleteSelected()}>Löschen</button></div></section>
  {/if}
  <section class="card"><h3>Aufräumen</h3>
    <label for="mr">Griffe kleiner als {minRel.toFixed(2)}× typisch</label><input id="mr" type="range" min="0.05" max="0.6" step="0.05" bind:value={minRel} />
    <div class="row" style="margin-top:6px"><span class="muted" style="font-size:12px" class:grow={true}>{smallN} betroffen</span><button class="sm" disabled={!smallN} onclick={() => { if (confirm(`${smallN} kleine Griffe entfernen?`)) editor.removeSmall(minRel); }}>Entfernen</button></div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">Tipp: Auf leere Fläche ziehen markiert einen Bereich (z. B. Schriftzug am Rand) – dann Entf.</p>
  </section>

{:else}
  <section class="card"><h3>Auswertung</h3>
    {#if replay.cur && replay.rp}
      <p class="muted" style="font-size:12px;margin:0 0 6px">Winkel, Spannweiten und Bahn sind 2D-Näherungen in der Wandebene.</p>
      <div class="kv"><span>Dauer</span><b>{fmt(replay.cur.dauer_ms)}</b><span>Züge</span><b>{sm.zuege}</b><span>Ø Zeit pro Zug</span><b>{num(sm.proZug, 1)} s</b><span>Pausen ≥ 2 s</span><b>{sm.pausen}</b>
        <span>Hüftbahn</span><b>{num(sm.hueftbahnM, 1)} m</b><span>Spannweite max / Ø</span><b>{num(sm.span?.max)} / {num(sm.span?.mean)} cm</b>
        <span>Ellbogen L</span><b>{num(sm.elbowL?.min)}–{num(sm.elbowL?.max)}°</b><span>Ellbogen R</span><b>{num(sm.elbowR?.min)}–{num(sm.elbowR?.max)}°</b><span>Knie L</span><b>{num(sm.kneeL?.min)}–{num(sm.kneeL?.max)}°</b><span>Knie R</span><b>{num(sm.kneeR?.min)}–{num(sm.kneeR?.max)}°</b>
        <span>dynamisch / statisch</span><b>{num((sm.dyn?.dynamisch ?? NaN) * 100)} / {num((sm.dyn?.statisch ?? NaN) * 100)} %</b><span>Links / Rechts</span><b>{num(replay.lr.anteilLinks * 100)} / {num((1 - replay.lr.anteilLinks) * 100)} %</b></div>
      <h3 style="margin-top:12px">Meistgenutzte Griffe</h3>
      <ol style="margin:0;padding-left:20px;font-size:13px">{#each replay.usage.slice(0, 6) as u (u.holdId)}<li>#{u.holdId} · {(u.ms / 1000).toFixed(1)} s {#each LIMBS as l (l)}{#if u.limbs[l] > 0}<span class="dot" style="background:{limbColor[l]}" title={l}></span>{/if}{/each}</li>{/each}</ol>
    {:else}<div class="empty" style="padding:14px">Wähle links eine Aufnahme.</div>{/if}
  </section>
  <section class="card"><h3>Route & Versuche</h3>
    <select bind:value={replay.routeId} aria-label="Route" onchange={() => replay.version++}><option value="">– keine Route –</option>{#each app.routes as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select>
    {#if !replay.editRoute}
      <div class="row" style="margin-top:6px"><button class="sm" onclick={() => { replay.editRoute = true; replay.draft = []; replay.version++; }}>Neue Route</button>{#if replay.route}<button class="sm danger" onclick={() => replay.deleteRoute()}>Löschen</button>{/if}</div>
    {:else}
      <input type="text" style="margin-top:6px" bind:value={replay.routeName} aria-label="Routenname" />
      <select style="margin-top:6px" bind:value={replay.draftRole} aria-label="Rolle"><option value="start">Startgriff</option><option value="hand">Hand</option><option value="fuss">Fuß</option><option value="top">Top</option></select>
      <p class="muted" style="font-size:12px">Klicke die Griffe an der Wand an ({replay.draft.length} gewählt).</p>
      <div class="row"><button class="sm primary" disabled={!replay.draft.length} onclick={() => replay.saveRoute()}>Speichern</button><button class="sm" onclick={() => { replay.editRoute = false; replay.draft = []; replay.version++; }}>Abbrechen</button></div>
    {/if}
    {#if replay.compare}<div style="margin-top:8px;font-size:13px">Soll/Ist: {replay.compare.getroffen} von {replay.compare.soll} ({num(replay.compare.anteil * 100)} %){#if replay.compare.zusaetzlich.length}<br />zusätzlich: {replay.compare.zusaetzlich.join(', ')}{/if}</div>
      {#each replay.attempts as a, i (i)}<div style="font-size:13px">Versuch {i + 1}: {fmt(a.startMs)}–{fmt(a.endMs)} · {a.ende} · {a.zuege} Züge</div>{:else}<div class="muted" style="font-size:12px">Kein Versuch erkannt.</div>{/each}{/if}
  </section>
  <section class="card"><h3>Export</h3>
    <div class="row"><button class="sm" disabled={!replay.cur} onclick={() => replay.exportJson()}>JSON</button><button class="sm" disabled={!replay.cur} onclick={() => replay.exportEvents()}>Kontakte (CSV)</button><button class="sm" disabled={!replay.cur} onclick={() => replay.exportSeries()}>Zeitreihe (CSV)</button>
      <button class="sm" onclick={async () => replay.exportBlob('wandkarte.png', (await app.stageApi?.png()) ?? null)}>Screenshot</button><button class="sm" onclick={() => replay.exportZip()}>Projekt (ZIP)</button></div>
  </section>
{/if}
