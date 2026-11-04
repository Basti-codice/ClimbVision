<script lang="ts">
  import { onMount } from 'svelte';
  import { app, type Page } from '../app/state.svelte';
  import { live } from '../app/live.svelte';
  import { t } from '../i18n';
  import { limbColor } from '../design/tokens';
  import { LIMBS } from '../core/schemas';
  import Start from './pages/Start.svelte';
  import Live from './pages/Live.svelte';
  import Scan from './pages/Scan.svelte';
  import Sessions from './pages/Sessions.svelte';
  import Esp32 from './pages/Esp32.svelte';
  import Settings from './pages/Settings.svelte';

  const NAV: [Page, string, string][] = [['start', 'nav.start', '1'], ['live', 'nav.live', '2'], ['scan', 'nav.scan', '3'], ['sessions', 'nav.sessions', '4'], ['esp32', 'nav.esp32', '5'], ['settings', 'nav.settings', '6']];
  onMount(() => {
    // Diagnose-Hook (nur mit ?debug in der URL): Zustand im Browser-Konsolenzugriff, z. B. für E2E-Tests
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, unknown>)['__cv'] = { app, live };
    void app.init().catch((e) => app.error(e, 'Start fehlgeschlagen: '));
  });
  $effect(() => { document.documentElement.classList.toggle('hc', app.settings.highContrast); });

  function key(e: KeyboardEvent): void {
    const el = e.target as HTMLElement; if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const n = NAV.find((x) => x[2] === k); if (n) { app.page = n[0]; return; }
    if (k === '[') app.leftOpen = !app.leftOpen; else if (k === ']') app.rightOpen = !app.rightOpen;
    else if (k.toLowerCase() === 'c') app.contentMode = !app.contentMode; else if (k === 'Escape' && app.contentMode) app.contentMode = false;
    else if (k.toLowerCase() === 'd') { app.settings.debug = !app.settings.debug; void app.saveSettings(); }
    else if (k.toLowerCase() === 'i' && app.page !== 'scan') { app.settings.showIds = !app.settings.showIds; void app.saveSettings(); }
    else if (k.toLowerCase() === 's' && app.page === 'live') { app.settings.showSkeleton = !app.settings.showSkeleton; void app.saveSettings(); }
    else if (k.toLowerCase() === 'l' && app.page === 'live' && live.running) live.armLock = !live.armLock;
    else if (k.toLowerCase() === 'f' && app.page === 'live') { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
  }
  const out = $derived(app.output); const st = $derived(app.stats);
  const sec = (k: string): void => { app.sections[k] = !app.sections[k]; };
  const conf = (c: number): string => `${Math.round(c * 100)}%`;
</script>

<svelte:window onkeydown={key} />

{#if !app.ready}
  <div class="boot"><div><h1>{t('app.name')}</h1><p class="muted">Lade lokale Daten …</p></div></div>
{:else}
  <div class="shell" class:content={app.contentMode} style:--l={app.leftOpen && !app.contentMode ? 'var(--sidebar-l)' : '0px'} style:--r={app.rightOpen && !app.contentMode && app.page === 'live' ? 'var(--sidebar-r)' : '0px'}>
    {#if !app.contentMode}
      <aside class="left" class:closed={!app.leftOpen} aria-label="Navigation und Einstellungen">
        <div class="brand"><svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="M6 24 L13 10 L18 18 L21 13 L27 24Z" fill="none" stroke="#7cc4ff" stroke-width="2.4" stroke-linejoin="round" /></svg><b>{t('app.name')}</b></div>
        <nav>{#each NAV as [p, l, k] (p)}<button class="nav" class:on={app.page === p} onclick={() => { app.page = p; }}><span>{t(l)}</span><span class="kbd">{k}</span></button>{/each}</nav>
        <div class="ctx">
          <h3>Wandprofil</h3>
          <select aria-label="Wandprofil" value={app.profile?.id ?? ''} onchange={(e) => app.selectProfile((e.target as HTMLSelectElement).value)}>{#if !app.profiles.length}<option value="">– keins –</option>{/if}{#each app.profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}</select>
          <h3>Modell</h3>
          <select aria-label="Pose-Modell" bind:value={app.settings.poseModel} onchange={() => app.saveSettings()} disabled={live.running}><option value="pose_lite">Pose Lite (schnell)</option><option value="pose_full">Pose Full (genauer)</option></select>
          <h3>Anzeige</h3>
          {#each [['showIds', 'Griff-IDs'], ['showSkeleton', 'Skelett'], ['showConf', 'Konfidenz'], ['debug', 'Debug']] as [k, l] (k)}
            <label class="chk"><input type="checkbox" checked={app.settings[k as 'debug']} onchange={(e) => { (app.settings as unknown as Record<string, boolean>)[k as string] = (e.target as HTMLInputElement).checked; void app.saveSettings(); }} /> {l}</label>{/each}
          <p class="muted priv">{t('privacy')}</p>
        </div>
      </aside>
      <button class="edge l" onclick={() => { app.leftOpen = !app.leftOpen; }} aria-label={app.leftOpen ? t('side.collapse') : t('side.expand')} title="[">{app.leftOpen ? '‹' : '›'}</button>
    {/if}

    <main>
      {#if app.page === 'start'}<Start />{:else if app.page === 'live'}<Live />{:else if app.page === 'scan'}<Scan />{:else if app.page === 'sessions'}<Sessions />{:else if app.page === 'esp32'}<Esp32 />{:else}<Settings />{/if}
    </main>

    {#if !app.contentMode && app.page === 'live'}
      <button class="edge r" onclick={() => { app.rightOpen = !app.rightOpen; }} aria-label={app.rightOpen ? t('side.collapse') : t('side.expand')} title="]">{app.rightOpen ? '›' : '‹'}</button>
      <aside class="right" class:closed={!app.rightOpen} aria-label="Kontakte und Status">
        <section><button class="sh" onclick={() => sec('kontakte')}>Kontakte {app.sections['kontakte'] ? '▾' : '▸'}</button>
          {#if app.sections['kontakte']}
            {#each LIMBS as l (l)}{@const s = out?.contact.limbs[l]}
              <div class="limb" style:border-left-color={limbColor[l]}>
                <b style:color={limbColor[l]}>{l}</b><span class="grow">{t('limb.' + l)}</span>
                {#if s && s.holdId !== null && s.state !== 'FREE'}<span class="mono">Griff {s.holdId}</span><span class="badge" class:warn={s.evidence === 'geschaetzt' || s.ambiguous}>{conf(s.confidence)}</span>{:else}<span class="muted">—</span>{/if}
                {#if s && s.ambiguous}<span class="badge warn" title="Mehrere Griffe in Reichweite">mehrdeutig</span>{/if}
                {#if s && s.state === 'OCCLUDED_HOLD'}<span class="badge" title="Position geschätzt, Gliedmaße verdeckt">geschätzt</span>{/if}
              </div>{/each}
            {#if !out}<p class="muted">Noch keine Daten – Live starten.</p>{/if}
          {/if}</section>
        <section><button class="sh" onclick={() => sec('status')}>Tracking-Status {app.sections['status'] ? '▾' : '▸'}</button>
          {#if app.sections['status']}<div class="kv"><span>Person</span><b>{out ? t('track.' + out.status) : '—'}</b><span>Sperre</span><b>{out?.locked ? 'aktiv' : 'aus'}</b>
            <span>Registrierung</span><b>{app.registration.ampel}</b><span>Drift</span><b>{live.drift ? `${(live.drift.betrag * 100).toFixed(2)} % (${live.drift.status})` : '—'}</b></div>{/if}</section>
        <section><button class="sh" onclick={() => sec('hud')}>Performance {app.sections['hud'] ? '▾' : '▸'}</button>
          {#if app.sections['hud']}<div class="kv mono"><span>Pose</span><b>{st ? st.poseHz.toFixed(1) : '—'} Hz</b><span>Pose-Inferenz</span><b>{st ? st.poseMs.toFixed(0) : '—'} ms</b><span>Hand</span><b>{st ? `${st.handHz.toFixed(1)} Hz · ${st.handMs.toFixed(0)} ms` : '—'}</b>
            <span>Latenz (Senden→Ergebnis)</span><b>{st ? st.latencyMs.toFixed(0) : '—'} ms</b><span>Render</span><b>{app.renderFps.toFixed(0)} FPS</b><span>Verworfene Frames</span><b>{st ? st.dropped : '—'}</b></div>{/if}</section>
        <section><button class="sh" onclick={() => sec('debug')}>Debug {app.sections['debug'] ? '▾' : '▸'}</button>
          {#if app.sections['debug']}{#each LIMBS as l (l)}{@const s = out?.contact.limbs[l]}<div class="mono dbg"><b>{l}</b> {s?.state ?? '—'} {#if s?.debug}pos {s.debug.pos.toFixed(2)} · v {s.debug.speed.toFixed(2)} · dwell {s.debug.dwell.toFixed(2)} · pl {s.debug.plaus.toFixed(2)}{/if}{#if s?.flags.length} [{s.flags.join(', ')}]{/if}
            {#each s?.candidates ?? [] as c (c.holdId)}<div>↳ #{c.holdId} {c.score.toFixed(2)} {Number.isFinite(c.distanceCm) ? c.distanceCm.toFixed(1) + ' cm' : ''}</div>{/each}</div>{/each}{/if}</section>
        <section><button class="sh" onclick={() => sec('auswertung')}>Live-Auswertung {app.sections['auswertung'] ? '▾' : '▸'}</button>
          {#if app.sections['auswertung']}<div class="kv"><span>Aktive Griffe</span><b>{out?.contact.aktiveGriffe.join(', ') || '—'}</b><span>Aufnahme</span><b>{live.recording ? `${live.recFrames} Frames` : 'aus'}</b><span>ESP32</span><b>{app.esp.status.state}{app.esp.status.latencyMs !== null ? ` · ${app.esp.status.latencyMs} ms` : ''}</b></div>{/if}</section>
      </aside>
    {/if}

    <div class="toasts" aria-live="polite">{#each app.toasts as x (x.id)}<div class="toast {x.kind}" role="status">{x.text}</div>{/each}</div>
  </div>
{/if}

<style>
  .boot { height: 100%; display: grid; place-items: center; text-align: center; }
  .shell { display: grid; grid-template-columns: var(--l) minmax(0, 1fr) var(--r); height: 100%; position: relative; transition: grid-template-columns .15s; } .shell.content { grid-template-columns: 0 1fr 0; }
  aside { background: var(--c-surface); border-right: 1px solid var(--c-border); overflow: auto; min-width: 0; } aside.closed { display: none; } .right { border-right: none; border-left: 1px solid var(--c-border); padding: 8px; }
  main { min-width: 0; min-height: 0; overflow: hidden; position: relative; } .brand { display: flex; align-items: center; gap: 10px; padding: 14px 16px; font-size: 17px; }
  nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; } .nav { display: flex; justify-content: space-between; align-items: center; text-align: left; border-color: transparent; background: transparent; } .nav.on { background: color-mix(in srgb, var(--c-accent) 18%, transparent); border-color: var(--c-accent); }
  .ctx { padding: 12px 16px; } .ctx h3 { margin: 14px 0 6px; } .chk { display: flex; gap: 8px; align-items: center; margin: 4px 0; font-size: 14px; color: var(--c-text); } .chk input { width: 18px; height: 18px; accent-color: var(--c-accent); } .priv { font-size: 12px; margin-top: 20px; }
  .edge { position: absolute; z-index: 15; top: 50%; width: 22px; min-height: 56px; padding: 0; border-radius: 0 8px 8px 0; } .edge.l { left: calc(var(--l) - 1px); } .edge.r { right: calc(var(--r) - 1px); border-radius: 8px 0 0 8px; }
  .sh { width: 100%; text-align: left; border: none; background: transparent; font-weight: 650; font-size: 13px; color: var(--c-textMuted); text-transform: uppercase; letter-spacing: .04em; min-height: 36px; } section { border-bottom: 1px solid var(--c-border); padding-bottom: 8px; margin-bottom: 4px; }
  .limb { display: flex; gap: 6px; align-items: center; padding: 6px 8px; border-left: 4px solid; margin: 4px 0; background: var(--c-surface2); border-radius: 0 8px 8px 0; flex-wrap: wrap; } .kv { display: grid; grid-template-columns: 1fr auto; gap: 3px 10px; font-size: 13px; padding: 0 4px; } .kv span { color: var(--c-textMuted); } .dbg { font-size: 11px; margin: 4px 0; }
  .toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 100; max-width: min(640px, 92vw); } .toast { padding: 10px 14px; border-radius: 10px; background: var(--c-surface2); border: 1px solid var(--c-border); box-shadow: var(--elev-2); }
  .toast.ok { border-color: var(--c-ok); } .toast.warn { border-color: var(--c-warn); } .toast.err { border-color: var(--c-error); }
  @media (max-width: 1000px) { .shell { grid-template-columns: 0 1fr 0 !important; } aside { position: absolute; z-index: 30; height: 100%; width: 300px; } .edge { display: none; } }
</style>
