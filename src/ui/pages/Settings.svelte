<script lang="ts">
  import { app, DEFAULT_SETTINGS } from '../../app/state.svelte';
  import { MODELS } from '../../app/models';
  import { setLang, t } from '../../i18n';
  import { openDb } from '../../storage/db';
  let usage = $state(0);
  $effect(() => { void app.store?.estimateBytes().then((n) => { usage = n; }); });
  const save = (): void => { void app.saveSettings(); };
  function reset(): void { Object.assign(app.settings, DEFAULT_SETTINGS); save(); app.toast('Einstellungen zurückgesetzt.', 'ok'); }
  async function wipe(): Promise<void> {
    if (!confirm('ALLE lokalen Daten (Wandprofile, Griffe, Sessions, Modelle, Einstellungen) unwiderruflich löschen?')) return;
    indexedDB.deleteDatabase('climbvision'); localStorage.clear(); location.reload();
  }
  void openDb;
  const SHORT: [string, string][] = [['1 … 6', 'Seiten wechseln'], ['[  ]', 'linke / rechte Seitenleiste'], ['F', 'Vollbild (Live)'], ['C', 'Content-Modus'], ['D', 'Debug-Overlay'], ['I', 'Griff-IDs'], ['S', 'Skelett'], ['L', 'Person sperren (Live)'], ['Strg+Z / Y', 'Rückgängig / Wiederholen (Editor)'], ['V E P T W', 'Editor-Werkzeuge'], ['Entf', 'Auswahl löschen'], ['M', 'Auswahl zusammenführen']];
</script>

<div class="page">
  <h1>Einstellungen</h1>
  <div class="grid">
    <section class="panel"><h2>Erkennung</h2>
      <label for="pm">Pose-Modell</label><select id="pm" bind:value={app.settings.poseModel} onchange={save}>{#each ['pose_lite', 'pose_full'] as id (id)}<option value={id}>{MODELS[id as 'pose_lite'].name} – {MODELS[id as 'pose_lite'].hinweis}{app.modelsCached[id] ? '' : ' (nicht geladen)'}</option>{/each}</select>
      <label class="chk"><input type="checkbox" bind:checked={app.settings.useHands} onchange={save} /> Hand-Tracking (Fingerspitzen) auf Ausschnitt nutzen</label>
      <label for="hi">Hand-Erkennung höchstens alle {app.settings.handIntervalMs} ms</label><input id="hi" type="range" min="50" max="400" step="10" bind:value={app.settings.handIntervalMs} onchange={save} />
      <label for="dg">Rechen-Backend</label><select id="dg" bind:value={app.settings.delegate} onchange={save}><option value="CPU">CPU (WASM) – Standard</option><option value="GPU">GPU (WebGL, integrierte Grafik) – experimentell</option></select>
      <label class="chk"><input type="checkbox" bind:checked={app.settings.swapLeftRight} onchange={save} /> Links/Rechts tauschen (falls das Modell bei Sicht von hinten verwechselt)</label>
    </section>
    <section class="panel"><h2>Kontaktlogik</h2>
      <label for="th">Toleranz Hand: {app.settings.tolHandCm} cm</label><input id="th" type="range" min="1" max="12" step="0.5" bind:value={app.settings.tolHandCm} onchange={save} />
      <label for="tf">Toleranz Fuß: {app.settings.tolFootCm} cm</label><input id="tf" type="range" min="1" max="15" step="0.5" bind:value={app.settings.tolFootCm} onchange={save} />
      <label for="on">Schwelle Kontakt AN: {app.settings.thetaOn.toFixed(2)}</label><input id="on" type="range" min="0.4" max="0.95" step="0.01" bind:value={app.settings.thetaOn} onchange={() => { if (app.settings.thetaOff > app.settings.thetaOn - 0.1) app.settings.thetaOff = app.settings.thetaOn - 0.1; save(); }} />
      <label for="off">Schwelle Kontakt AUS: {app.settings.thetaOff.toFixed(2)} (immer unter AN – Hysterese)</label><input id="off" type="range" min="0.1" max="0.85" step="0.01" bind:value={app.settings.thetaOff} onchange={() => { if (app.settings.thetaOff > app.settings.thetaOn - 0.1) app.settings.thetaOff = app.settings.thetaOn - 0.1; save(); }} />
      <label for="mc">Glättung (One-Euro) minCutoff: {app.settings.oneEuroMinCutoff.toFixed(1)} Hz</label><input id="mc" type="range" min="0.3" max="5" step="0.1" bind:value={app.settings.oneEuroMinCutoff} onchange={save} />
      <label for="be">Glättung beta: {app.settings.oneEuroBeta.toFixed(2)}</label><input id="be" type="range" min="0" max="0.5" step="0.01" bind:value={app.settings.oneEuroBeta} onchange={save} />
      <p class="muted">Änderungen gelten ab dem nächsten Start der Live-Erkennung.</p>
    </section>
    <section class="panel"><h2>Anzeige</h2>
      {#each [['showIds', 'Griff-IDs anzeigen'], ['showSkeleton', 'Skelett anzeigen'], ['showConf', 'Konfidenz anzeigen'], ['debug', 'Debug-Overlay']] as [k, l] (k)}<label class="chk"><input type="checkbox" checked={app.settings[k as 'debug']} onchange={(e) => { (app.settings as unknown as Record<string, boolean>)[k as string] = (e.target as HTMLInputElement).checked; save(); }} /> {l}</label>{/each}
      <label for="bg">Wand-Hintergrund</label><select id="bg" bind:value={app.settings.wallBackground} onchange={save}><option value="foto">Entzerrtes Wandfoto (abgedunkelt)</option><option value="dunkel">Schematisch (dunkel)</option></select>
      <label for="lg">Sprache</label><select id="lg" bind:value={app.settings.lang} onchange={() => { setLang(app.settings.lang); save(); }}><option value="de">Deutsch</option><option value="en">English (teilweise)</option></select>
      <label class="chk"><input type="checkbox" bind:checked={app.settings.highContrast} onchange={save} /> Besonders hoher Kontrast</label>
    </section>
    <section class="panel"><h2>Aufnahme & Kamera</h2>
      <label class="chk"><input type="checkbox" bind:checked={app.settings.recordData} onchange={save} /> Session-Daten aufzeichnen (Standard: an)</label>
      <label class="chk"><input type="checkbox" bind:checked={app.settings.recordVideo} onchange={save} /> Video zusätzlich aufzeichnen (Standard: aus; bleibt lokal)</label>
      <label for="cw">Gewünschte Kamerabreite</label><select id="cw" bind:value={app.settings.cameraWidth} onchange={save}><option value={1920}>1920</option><option value={1280}>1280</option><option value={640}>640</option></select>
      <label for="cf">Gewünschte Bildrate</label><select id="cf" bind:value={app.settings.cameraFps} onchange={save}><option value={30}>30</option><option value={60}>60</option><option value={15}>15</option></select>
      <p class="muted">Der Browser liefert nicht immer das Gewünschte – die tatsächlichen Werte werden beim Öffnen angezeigt.</p>
    </section>
    <section class="panel"><h2>Daten & Datenschutz</h2>
      <p>{t('privacy')} Nach dem einmaligen Modell-Download arbeitet die App offline.</p>
      <p class="muted">Belegt: {(usage / 1e6).toFixed(1)} MB (Fotos, Modelle, Sessions)</p>
      <div class="row"><button onclick={reset}>Einstellungen zurücksetzen</button><button class="danger" onclick={wipe}>Alle Daten löschen</button></div>
    </section>
    <section class="panel"><h2>Tastenkürzel</h2><div class="kv">{#each SHORT as [k, d] (k)}<span class="kbd">{k}</span><span>{d}</span>{/each}</div></section>
  </div>
</div>
<style>
  .page { padding: 20px; height: 100%; overflow: auto; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 12px; align-items: start; }
  .chk { display: flex; gap: 8px; align-items: center; color: var(--c-text); font-size: 14px; margin: 10px 0 0; } .chk input { width: 18px; height: 18px; accent-color: var(--c-accent); }
  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; align-items: center; }
</style>
