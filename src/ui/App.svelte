<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { app } from '../app/state.svelte';
  import { live } from '../app/live.svelte';
  import { editor } from '../app/editor.svelte';
  import { replay } from '../app/replay.svelte';
  import { t } from '../i18n';
  import Stage from './Stage.svelte';
  import LeftPanel from './panels/LeftPanel.svelte';
  import RightPanel from './panels/RightPanel.svelte';
  import BottomBar from './panels/BottomBar.svelte';
  import SetupWizard from './SetupWizard.svelte';
  import SettingsDrawer from './SettingsDrawer.svelte';
  import CornerPicker from './CornerPicker.svelte';

  const MODES: ['live' | 'edit' | 'replay', string, string][] = [['live', 'Live', '1'], ['edit', 'Griffe', '2'], ['replay', 'Aufnahmen', '3']];
  onMount(() => {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>)['__cv'] = { app, live, editor, replay };
    void app.init().catch((e) => app.error(e, 'Start fehlgeschlagen: '));
    let raf = 0; const loop = (n: number): void => { replay.tick(n); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });
  $effect(() => { document.documentElement.classList.toggle('hc', app.settings.highContrast); });
  // Editor: bei Wandwechsel neu laden; beim Verlassen speichern
  $effect(() => { const id = app.profile?.id; untrack(() => { if (id) editor.load(); }); });
  function setMode(m: 'live' | 'edit' | 'replay'): void { if (app.mode === 'edit' && m !== 'edit') editor.flush(); if (m !== 'live' && live.running) { app.toast('Die Live-Erkennung läuft noch – sie wird beim Wechsel beendet und gespeichert.', 'info', 3000); void live.stop(); } app.mode = m; app.stageApi?.reset(); if (m === 'replay') void app.store.listSessions(app.profile?.id).then((x) => { app.sessions = x; }); }

  function key(e: KeyboardEvent): void {
    const el = e.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
    if (app.mode === 'edit' && editor.key(e)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const m = MODES.find((x) => x[2] === e.key); if (m && app.mode !== 'setup') { setMode(m[0]); return; }
    if (e.key === '[') app.leftOpen = !app.leftOpen; else if (e.key === ']') app.rightOpen = !app.rightOpen;
    else if (k === 'c') app.contentMode = !app.contentMode; else if (e.key === 'Escape') { app.contentMode = false; app.settingsOpen = false; }
    else if (k === 'd') { app.settings.debug = !app.settings.debug; void app.saveSettings(); }
    else if (k === 'i' && app.mode !== 'edit') { app.settings.showIds = !app.settings.showIds; void app.saveSettings(); }
    else if (k === 's') { app.settings.showSkeleton = !app.settings.showSkeleton; void app.saveSettings(); }
    else if (k === 'l' && app.mode === 'live' && live.running) live.armLock = !live.armLock;
    else if (k === 'f') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
  }
  let fps = $state(0);
  const regDot = $derived(app.registration.ampel === 'gruen' ? 'ok' : app.registration.ampel === 'gelb' ? 'warn' : app.registration.ampel === 'rot' ? 'err' : '');
</script>

<svelte:window onkeydown={key} />

{#if !app.ready}
  <div style="height:100%;display:grid;place-items:center;text-align:center"><div><h1>{t('app.name')}</h1><p class="muted">Lade lokale Daten …</p></div></div>
{:else}
  <div class="app" class:content={app.contentMode}>
    <header class="top">
      <div class="brand"><svg width="24" height="24" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 24 L13 10 L18 18 L21 13 L27 24Z" fill="none" stroke="#7cc4ff" stroke-width="2.4" stroke-linejoin="round" /></svg>{t('app.name')}</div>
      {#if app.profiles.length}
        <select aria-label="Wand wählen" style="width:190px" value={app.profile?.id ?? ''} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v === '__new') { app.mode = 'setup'; (e.target as HTMLSelectElement).value = app.profile?.id ?? ''; } else void app.selectProfile(v); }}>
          {#each app.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}<option value="__new">＋ Neue Wand …</option></select>
      {/if}
      {#if app.mode !== 'setup' && app.profile}
        <div class="modes" role="tablist" aria-label="Modus">{#each MODES as [m, l, k] (m)}<button role="tab" aria-selected={app.mode === m} class:on={app.mode === m} onclick={() => setMode(m)} title={`Taste ${k}`}>{l}</button>{/each}</div>
      {/if}
      <span class="grow"></span>
      {#if app.mode === 'live' && live.source}<span class="pill"><span class="dot {regDot}"></span> Wand {app.registration.ampel === 'gruen' ? 'ausgerichtet' : app.registration.ampel === 'gelb' ? 'ungenau' : app.registration.ampel === 'rot' ? 'nicht ausgerichtet' : '…'}</span>{/if}
      {#if live.running}<span class="pill" style="color:var(--c-error)">● läuft</span>{/if}
      <button class="sm" onclick={() => { app.leftOpen = !app.leftOpen; }} aria-label="Linke Leiste" title="[">◧</button>
      <button class="sm" onclick={() => { app.rightOpen = !app.rightOpen; }} aria-label="Rechte Leiste" title="]">◨</button>
      <button class="sm" onclick={() => (app.settingsOpen = !app.settingsOpen)} aria-label="Einstellungen">⚙ Einstellungen</button>
    </header>

    {#if app.mode === 'setup'}
      <div style="grid-row:2 / 4;min-height:0"><SetupWizard /></div>
    {:else}
      <div class="body" style:--lw={app.leftOpen && !app.contentMode ? '272px' : '0px'} style:--rw={app.rightOpen && !app.contentMode ? '300px' : '0px'}>
        <aside class="side l" style:display={app.leftOpen ? undefined : 'none'}><LeftPanel /></aside>
        <main style="min-width:0;min-height:0"><Stage bind:fps /></main>
        <aside class="side r" style:display={app.rightOpen ? undefined : 'none'}><RightPanel /></aside>
      </div>
      <BottomBar />
    {/if}

    {#if live.regPhase === 'ecken' && live.regBitmap}
      <div class="overlay-card" style="position:fixed;z-index:70"><div class="card" style="width:min(1000px,94vw);height:min(720px,90vh);max-width:none;text-align:left;display:flex;flex-direction:column">
        <h2>Wand-Ecken neu setzen</h2><p class="muted">Die Kamera scheint bewegt worden zu sein. Ziehe die vier Punkte auf die Wandecken.</p>
        <div style="flex:1;min-height:300px"><CornerPicker image={live.regBitmap} bind:corners={live.regCorners} /></div>
        <div class="row" style="margin-top:8px"><button class="primary" disabled={live.regCorners.length !== 4 || live.busy} onclick={() => live.finishRegistration()}>Übernehmen</button><button onclick={() => live.cancelRegistration()}>{t('btn.cancel')}</button></div></div></div>
    {:else if live.regPhase === 'rechnet' || live.regPhase === 'aufnahme'}
      <div class="overlay-card" style="position:fixed;z-index:70"><div class="card"><h2>Richte die Wand aus …</h2><progress style="width:100%"></progress></div></div>
    {/if}

    <SettingsDrawer />
    {#if app.contentMode}<button class="sm" style="position:fixed;top:8px;right:8px;z-index:90;opacity:.45" onclick={() => (app.contentMode = false)}>Content-Modus beenden (C / Esc)</button>{/if}
    <div class="toasts" aria-live="polite">{#each app.toasts as x (x.id)}<div class="toast {x.kind}" role="status">{x.text}</div>{/each}</div>
  </div>
{/if}
