<script lang="ts">
  import { app } from '../../app/state.svelte';
  import { live } from '../../app/live.svelte';
  import { editor } from '../../app/editor.svelte';
  import { replay } from '../../app/replay.svelte';
  import OutputCard from './OutputCard.svelte';
  let fileInput = $state<HTMLInputElement>(); let holdFile = $state<HTMLInputElement>();
  const s = $derived(app.settings);
  const save = (): void => { void app.saveSettings(); };
  async function pick(e: Event): Promise<void> { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await live.openSource('datei', f); (e.target as HTMLInputElement).value = ''; }
  async function importHolds(e: Event): Promise<void> { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; try { await editor.importFile(f); } catch (err) { app.error(err); } (e.target as HTMLInputElement).value = ''; }
  const fmt = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
</script>

{#if app.mode === 'live'}
  <section class="card"><h3>Quelle {#if live.source}<span class="dot ok"></span>{/if}</h3>
    {#if !live.source}
      <label for="cam">Kamera</label>
      <select id="cam" bind:value={live.deviceId} onfocus={() => live.refreshDevices()}>{#each live.devices as d (d.deviceId)}<option value={d.deviceId}>{d.label}</option>{:else}<option value="">Kamera suchen …</option>{/each}</select>
      <button class="primary" style="width:100%;margin-top:8px" disabled={live.busy} onclick={() => live.openSource('kamera')}>Kamera öffnen</button>
      <button style="width:100%;margin-top:6px" disabled={live.busy} onclick={() => fileInput?.click()}>Videodatei öffnen …</button>
      <input type="file" accept="video/*" hidden bind:this={fileInput} onchange={pick} />
      <p class="muted" style="font-size:12px;margin:8px 0 0">Die Kamera muss an derselben Stelle stehen wie beim Setup-Foto – dann richtet sich das Bild automatisch auf die Wand aus.</p>
    {:else}
      <div class="kv"><span>Quelle</span><b style="overflow:hidden;text-overflow:ellipsis">{live.sourceLabel}</b><span>Auflösung</span><b>{live.source.info().width}×{live.source.info().height}</b>{#if live.source.info().fps}<span>Bildrate</span><b>{Math.round(live.source.info().fps ?? 0)} fps</b>{/if}
        <span>Ausrichtung</span><b>{app.registration.ampel === 'gruen' ? 'in Ordnung' : app.registration.ampel === 'gelb' ? 'ungenau' : app.registration.ampel === 'rot' ? 'fehlgeschlagen' : '…'}</b></div>
      <div class="row" style="margin-top:8px"><button class="sm" disabled={live.busy || live.running} onclick={() => live.autoRegister()}>Neu ausrichten</button><button class="sm" disabled={live.running} onclick={() => live.beginRegistration()}>Ecken setzen</button><button class="sm danger" onclick={() => live.closeSource()}>Schließen</button></div>
    {/if}
  </section>

  <section class="card"><h3>Ansicht</h3>
    <div class="seg" role="group" aria-label="Wand-Hintergrund"><button class:on={s.wallBackground === 'live'} disabled={!live.source} onclick={() => { s.wallBackground = 'live'; save(); }}>Live-Bild</button><button class:on={s.wallBackground === 'foto'} onclick={() => { s.wallBackground = 'foto'; save(); }}>Wandfoto</button><button class:on={s.wallBackground === 'dunkel'} onclick={() => { s.wallBackground = 'dunkel'; save(); }}>Dunkel</button></div>
    {#if s.wallBackground === 'live'}<label for="vo">Deckkraft Live-Bild {Math.round(s.videoOpacity * 100)} %</label><input id="vo" type="range" min="0.1" max="1" step="0.05" bind:value={s.videoOpacity} onchange={save} />{/if}
    <label class="chk"><input type="checkbox" bind:checked={s.showSkeleton} onchange={save} /> Skelett</label>
    <label class="chk"><input type="checkbox" bind:checked={s.showIds} onchange={save} /> Griff-Nummern</label>
    <label class="chk"><input type="checkbox" bind:checked={s.showConf} onchange={save} /> Sicherheit in %</label>
    <label class="chk"><input type="checkbox" bind:checked={s.debug} onchange={save} /> Debug-Overlay</label>
  </section>

  <section class="card"><h3>Erkennung</h3>
    <label for="pm">Genauigkeit</label>
    <select id="pm" bind:value={s.poseModel} onchange={save} disabled={live.running}><option value="pose_lite">Schnell (Lite)</option><option value="pose_full">Genauer (Full)</option></select>
    <label class="chk"><input type="checkbox" bind:checked={s.useHands} onchange={save} disabled={live.running} /> Finger genauer erkennen</label>
    {#if !app.modelsCached[s.poseModel]}<p class="muted" style="font-size:12px;margin:8px 0 0">Das Modell wird beim ersten Start einmalig geladen (≈ 6–9 MB).</p>{/if}
  </section>
{:else if app.mode === 'edit'}
  <section class="card"><h3>Griff-Erkennung</h3>
    <label for="se">Empfindlichkeit {Math.round(editor.sensitivity * 100)} %</label>
    <input id="se" type="range" min="0" max="1" step="0.05" bind:value={editor.sensitivity} />
    <div class="muted" style="font-size:12px;display:flex;justify-content:space-between"><span>weniger Griffe</span><span>mehr (auch kleine)</span></div>
    <button class="primary" style="width:100%;margin-top:10px" disabled={editor.scanning || !app.rect} onclick={() => { if (editor.work.some((h) => h.quelle === 'manuell') && !confirm('Die Erkennung ersetzt alle Griffe inkl. deiner manuellen Änderungen (Strg+Z macht es rückgängig). Fortfahren?')) return; void editor.scan(); }}>{editor.work.length ? 'Neu erkennen' : 'Griffe erkennen'}</button>
    <details style="margin-top:8px"><summary class="muted" style="cursor:pointer">Erweitert</summary>
      <label for="po">Griffe sind …</label><select id="po" bind:value={editor.polarity}><option value="auto">automatisch</option><option value="hell">heller als die Wand</option><option value="dunkel">dunkler als die Wand</option></select>
      <label for="wt">Zauberstab-Toleranz {editor.wandTol}</label><input id="wt" type="range" min="8" max="90" bind:value={editor.wandTol} />
    </details>
  </section>
  <section class="card"><h3>Ansicht</h3>
    <label class="chk"><input type="checkbox" bind:checked={s.showIds} onchange={save} /> Griff-Nummern</label>
    <label class="chk"><input type="checkbox" bind:checked={editor.showSuspicious} onchange={() => { editor.version++; }} /> Fragwürdige Griffe markieren</label>
  </section>
  <section class="card"><h3>Datei</h3>
    <div class="row"><button class="sm" disabled={!editor.work.length} onclick={() => editor.exportJson()}>Exportieren</button><button class="sm" onclick={() => holdFile?.click()}>Importieren</button></div>
    <input type="file" accept=".json,application/json" hidden bind:this={holdFile} onchange={importHolds} />
    <p class="muted" style="font-size:12px;margin:8px 0 0">Änderungen werden automatisch gespeichert.</p>
  </section>
{:else}
  <section class="card"><h3>Aufnahmen</h3>
    {#if app.sessions.length === 0}<div class="empty" style="padding:14px">Noch keine Aufnahmen. Sie entstehen automatisch, wenn du im Live-Modus „Starten“ und „Stoppen“ drückst.</div>{/if}
    {#each app.sessions as x (x.id)}
      <div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><button class="grow" style="text-align:left;min-height:48px;{replay.cur?.id === x.id ? 'border-color:var(--c-accent)' : ''}" onclick={() => replay.open(x)}><b>{new Date(x.start).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</b><br /><span class="muted" style="font-size:12px">{fmt(x.dauer_ms)} · {x.events.length} Kontakte</span></button><button class="sm danger" aria-label="Aufnahme löschen" onclick={() => replay.deleteSession(x)}>✕</button></div>
    {/each}
  </section>
  <section class="card"><h3>Ansicht</h3>
    <label class="chk"><input type="checkbox" bind:checked={replay.heat} onchange={() => replay.version++} /> Griff-Heatmap</label>
    <label class="chk"><input type="checkbox" bind:checked={s.showIds} onchange={save} /> Griff-Nummern</label>
    <label for="gh">Vergleich (Ghost)</label>
    <select id="gh" value={replay.ghostId} onchange={(e) => replay.chooseGhost((e.target as HTMLSelectElement).value)}><option value="">– keiner –</option>{#each app.sessions.filter((x) => x.id !== replay.cur?.id) as x (x.id)}<option value={x.id}>{new Date(x.start).toLocaleString('de-DE')}</option>{/each}</select>
  </section>
{/if}
<OutputCard />
