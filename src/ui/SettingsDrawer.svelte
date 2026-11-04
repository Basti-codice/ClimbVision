<script lang="ts">
  import { app, DEFAULT_SETTINGS } from '../app/state.svelte';
  import { setLang, t } from '../i18n';
  let usage = $state(0);
  $effect(() => { if (app.settingsOpen) void app.store?.estimateBytes().then((n) => { usage = n; }); });
  const save = (): void => { void app.saveSettings(); };
  const s = $derived(app.settings);
  function reset(): void { Object.assign(app.settings, DEFAULT_SETTINGS); save(); app.toast('Einstellungen zurückgesetzt.', 'ok'); }
  async function wipe(): Promise<void> { if (!confirm('ALLE lokalen Daten (Wände, Griffe, Aufnahmen, Modelle, Einstellungen) unwiderruflich löschen?')) return; indexedDB.deleteDatabase('climbvision'); localStorage.clear(); location.reload(); }
  async function rename(id: string): Promise<void> { const p = app.profiles.find((x) => x.id === id); if (!p) return; const n = prompt('Neuer Name', p.name); if (!n) return; await app.store.putProfile({ ...$state.snapshot(p), name: n, geaendert: new Date().toISOString() }); app.profiles = await app.store.listProfiles(); if (app.profile?.id === id) await app.selectProfile(id); }
  async function dup(id: string): Promise<void> { try { const n = await app.store.duplicateProfile(id, crypto.randomUUID(), (app.profiles.find((p) => p.id === id)?.name ?? 'Wand') + ' (Kopie)'); app.profiles = await app.store.listProfiles(); app.toast(`„${n.name}“ angelegt.`, 'ok'); } catch (e) { app.error(e); } }
  async function del(id: string): Promise<void> { if (!confirm('Diese Wand samt Griffen, Routen und Aufnahmen unwiderruflich löschen?')) return; await app.store.deleteProfile(id); app.profiles = await app.store.listProfiles(); if (app.profile?.id === id) { const n = app.profiles[0]; if (n) await app.selectProfile(n.id); else { app.profile = null; app.holds = []; app.mode = 'setup'; } } }
  const SHORT: [string, string][] = [['1 2 3', 'Live · Griffe · Aufnahmen'], ['[  ]', 'Seitenleisten ein/aus'], ['C', 'Content-Modus (nur Wand)'], ['F', 'Vollbild'], ['L', 'Person sperren'], ['D / I / S', 'Debug · Nummern · Skelett'], ['V A P T E', 'Griff-Werkzeuge'], ['Entf · M', 'Löschen · Verbinden'], ['Strg+Z / Y', 'Rückgängig / Wiederholen']];
</script>

{#if app.settingsOpen}
  <div class="drawer" role="dialog" aria-label="Einstellungen">
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0" class="grow">Einstellungen</h2><button class="sm" onclick={() => (app.settingsOpen = false)}>Schließen ✕</button></div>

    <section class="card"><h3>Wände</h3>
      {#each app.profiles as p (p.id)}<div class="row" style="margin-bottom:6px;flex-wrap:nowrap"><span class="grow">{p.name}{app.profile?.id === p.id ? ' ✓' : ''}</span><button class="sm" onclick={() => rename(p.id)}>Umbenennen</button><button class="sm" onclick={() => dup(p.id)}>Kopie</button><button class="sm danger" onclick={() => del(p.id)}>✕</button></div>{/each}
      <button class="sm" onclick={() => { app.settingsOpen = false; app.mode = 'setup'; }}>+ Neue Wand einrichten</button>
    </section>

    <section class="card"><h3>Kontakt-Erkennung</h3>
      <label for="th">Toleranz Hand: {s.tolHandCm} cm</label><input id="th" type="range" min="1" max="12" step="0.5" bind:value={s.tolHandCm} onchange={save} />
      <label for="tf">Toleranz Fuß: {s.tolFootCm} cm</label><input id="tf" type="range" min="1" max="15" step="0.5" bind:value={s.tolFootCm} onchange={save} />
      <label for="on">Kontakt erkannt ab: {s.thetaOn.toFixed(2)}</label><input id="on" type="range" min="0.4" max="0.95" step="0.01" bind:value={s.thetaOn} onchange={() => { if (s.thetaOff > s.thetaOn - 0.1) s.thetaOff = s.thetaOn - 0.1; save(); }} />
      <label for="off">Kontakt gelöst unter: {s.thetaOff.toFixed(2)}</label><input id="off" type="range" min="0.1" max="0.85" step="0.01" bind:value={s.thetaOff} onchange={() => { if (s.thetaOff > s.thetaOn - 0.1) s.thetaOff = s.thetaOn - 0.1; save(); }} />
      <label for="mc">Glättung: {s.oneEuroMinCutoff.toFixed(1)} Hz (kleiner = ruhiger, träger)</label><input id="mc" type="range" min="0.3" max="5" step="0.1" bind:value={s.oneEuroMinCutoff} onchange={save} />
      <label class="chk"><input type="checkbox" bind:checked={s.swapLeftRight} onchange={save} /> Links/Rechts tauschen (falls das Modell von hinten verwechselt)</label>
      <p class="muted" style="font-size:12px">Gilt ab dem nächsten Start der Erkennung.</p>
    </section>

    <section class="card"><h3>Aufnahme & Leistung</h3>
      <label class="chk"><input type="checkbox" bind:checked={s.recordData} onchange={save} /> Bewegungsdaten aufzeichnen</label>
      <label class="chk"><input type="checkbox" bind:checked={s.recordVideo} onchange={save} /> Video zusätzlich aufzeichnen (bleibt lokal)</label>
      <label for="hi">Finger-Erkennung höchstens alle {s.handIntervalMs} ms</label><input id="hi" type="range" min="50" max="400" step="10" bind:value={s.handIntervalMs} onchange={save} />
      <label for="dg">Rechen-Backend</label><select id="dg" bind:value={s.delegate} onchange={save}><option value="CPU">CPU – Standard</option><option value="GPU">GPU (integrierte Grafik) – experimentell</option></select>
      <label for="cw">Kamera-Auflösung (gewünscht)</label><select id="cw" bind:value={s.cameraWidth} onchange={save}><option value={1920}>1920</option><option value={1280}>1280</option><option value={640}>640</option></select>
    </section>

    <section class="card"><h3>Darstellung</h3>
      <label for="lg">Sprache</label><select id="lg" bind:value={s.lang} onchange={() => { setLang(s.lang); save(); }}><option value="de">Deutsch</option><option value="en">English (teilweise)</option></select>
      <label class="chk"><input type="checkbox" bind:checked={s.highContrast} onchange={save} /> Besonders hoher Kontrast</label>
    </section>

    <section class="card"><h3>Daten & Datenschutz</h3>
      <p style="margin:0 0 6px">{t('privacy')}</p><p class="muted" style="font-size:12px;margin:0 0 8px">Belegt: {(usage / 1e6).toFixed(1)} MB · abgewehrte Fremdzugriffe von Bibliotheken: {app.blockedExternal.count}</p>
      <div class="row"><button class="sm" onclick={reset}>Einstellungen zurücksetzen</button><button class="sm danger" onclick={wipe}>Alle Daten löschen</button></div>
    </section>

    <section class="card"><h3>Tastenkürzel</h3><div class="kv" style="grid-template-columns:auto 1fr;gap:6px 14px">{#each SHORT as [k, d] (k)}<span class="kbd">{k}</span><span style="color:var(--c-text)">{d}</span>{/each}</div></section>
  </div>
{/if}
