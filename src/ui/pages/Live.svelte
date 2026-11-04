<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../../app/state.svelte';
  import { live } from '../../app/live.svelte';
  import WallMap from '../WallMap.svelte';
  import CornerPicker from '../CornerPicker.svelte';
  import { t } from '../../i18n';
  import { applyH, inv3, type Mat3 } from '../../geometry/homography';
  import { limbColor } from '../../design/tokens';

  let map = $state<ReturnType<typeof WallMap>>();
  let pipHost = $state<HTMLDivElement>(); let overlay = $state<HTMLCanvasElement>(); let center = $state<HTMLDivElement>();
  let pip = $state({ x: 16, y: 16, w: 320 }); let dragging: { dx: number; dy: number } | null = null;
  let renderFps = $state(0); let raf = 0; let fileInput = $state<HTMLInputElement>();
  const s = $derived(app.settings);
  const rdy = $derived(live.ready);

  // Kamera-Element in das PiP hängen
  $effect(() => {
    const el = live.source?.element; if (!pipHost) return;
    if (el) { el.style.width = '100%'; el.style.height = '100%'; el.style.objectFit = 'contain'; el.style.display = 'block'; pipHost.replaceChildren(el); } else pipHost.replaceChildren();
  });

  // Skelett-Overlay auf dem Kamerabild (Wand → Bild über Inverse der Registrierungs-Homographie)
  function drawOverlay(): void {
    const c = overlay; if (!c || !pipHost) return;
    const r = pipHost.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
    const g = c.getContext('2d') as CanvasRenderingContext2D; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
    const v = live.source?.element, h = app.registration.h, st = live.renderState();
    if (!v || !h || !st.skeleton || !s.showSkeleton) return;
    const vw = v.videoWidth || 1, vh = v.videoHeight || 1, k = Math.min(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
    const hi = inv3(h as Mat3);
    const pts = st.skeleton.map((p) => { if (!p) return null; const q = applyH(hi, [p.u, p.v]); return { x: ox + q[0] * vw * k, y: oy + q[1] * vh * k, c: p.c }; });
    const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [27, 29], [28, 30]];
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2;
    for (const [a, b] of BONES) { const p = pts[a as number], q = pts[b as number]; if (!p || !q || p.c < 0.3 || q.c < 0.3) continue; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); }
    const ends: [string, number][] = s.swapLeftRight ? [['LH', 16], ['RH', 15], ['LF', 32], ['RF', 31]] : [['LH', 15], ['RH', 16], ['LF', 31], ['RF', 32]];
    for (const [l, i] of ends) { const p = pts[i]; if (!p || p.c < 0.2) continue; g.fillStyle = limbColor[l as 'LH']; g.beginPath(); g.arc(p.x, p.y, 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); }
  }
  onMount(() => { const loop = (): void => { drawOverlay(); raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); void live.refreshDevices(); });
  onDestroy(() => cancelAnimationFrame(raf));

  function pipDown(e: PointerEvent): void { dragging = { dx: e.clientX - pip.x, dy: e.clientY - pip.y }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }
  function pipMove(e: PointerEvent): void { if (dragging) { pip = { ...pip, x: Math.max(0, e.clientX - dragging.dx), y: Math.max(0, e.clientY - dragging.dy) }; } }
  function pipClick(e: MouseEvent): void {
    if (!live.armLock) return; const r = pipHost!.getBoundingClientRect(); const v = live.source?.element; if (!v) return;
    const vw = v.videoWidth || 1, vh = v.videoHeight || 1, k = Math.min(r.width / vw, r.height / vh), ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
    live.lockPerson({ x: (e.clientX - r.left - ox) / (vw * k), y: (e.clientY - r.top - oy) / (vh * k) }); app.toast('Person wird gesperrt …', 'info', 2500);
  }
  function fullscreen(): void { if (document.fullscreenElement) void document.exitFullscreen(); else void center?.requestFullscreen(); }
  async function snapshot(): Promise<void> { const b = await map?.toPng(); if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `climbvision-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click(); }
  const regBadge = $derived(app.registration.ampel === 'gruen' ? ['ok', t('reg.gruen')] : app.registration.ampel === 'gelb' ? ['warn', t('reg.gelb')] : app.registration.ampel === 'rot' ? ['err', t('reg.rot')] : ['warn', 'Aufstellung nicht registriert']);
  async function open(e: Event): Promise<void> { const f = (e.target as HTMLInputElement).files?.[0]; if (f) await live.openSource('datei', f); (e.target as HTMLInputElement).value = ''; }
</script>

<div class="live" class:content={app.contentMode}>
  {#if !app.contentMode}
    <div class="bar panel">
      {#if !live.running}
        <select bind:value={live.deviceId} aria-label="Kamera" style="width:200px" onfocus={() => live.refreshDevices()}>{#each live.devices as d (d.deviceId)}<option value={d.deviceId}>{d.label}</option>{:else}<option value="">Keine Kamera gefunden</option>{/each}</select>
        <button onclick={() => live.openSource('kamera')} disabled={live.busy}>Kamera öffnen</button>
        <button onclick={() => fileInput?.click()} disabled={live.busy}>Videodatei öffnen</button>
        <input type="file" accept="video/*" hidden bind:this={fileInput} onchange={open} />
        <button onclick={() => live.beginRegistration()} disabled={!live.source || live.busy || !app.profile}>Wand registrieren</button>
        <button class="primary" onclick={() => live.start()} disabled={live.busy}>{t('btn.start')}</button>
      {:else}
        <button class="danger" onclick={() => live.stop()}>{t('btn.stop')}</button>
        <button class:on={live.armLock} onclick={() => { live.armLock = !live.armLock; }} title="Dann das Kamerabild an der Person anklicken">{t('btn.lock')}</button>
        <button onclick={() => live.unlockPerson()}>{t('btn.unlock')}</button>
        <button onclick={() => live.beginRegistration()}>Neu registrieren</button>
      {/if}
      <span class="badge {regBadge[0]}">{regBadge[1]}</span>
      {#if live.sourceLabel}<span class="badge">{live.sourceLabel}</span>{/if}
      {#if live.recording}<span class="badge err">● Datenaufnahme · {live.recFrames}</span>{/if}
      <span class="grow"></span>
      <button class="sm" class:on={s.showCamera} onclick={() => { app.settings.showCamera = !s.showCamera; void app.saveSettings(); }}>Kamera</button>
      <button class="sm" class:on={s.cameraFocus} onclick={() => { app.settings.cameraFocus = !s.cameraFocus; void app.saveSettings(); }}>Kamerafokus</button>
      <button class="sm" onclick={snapshot}>Screenshot</button>
      <button class="sm" onclick={fullscreen} title="F">Vollbild</button>
      <button class="sm" onclick={() => { app.contentMode = true; }} title="C">Content-Modus</button>
    </div>
  {/if}

  {#if !rdy.ok && !live.running && !app.contentMode}<div class="notice">{rdy.grund}</div>{/if}
  {#if live.paused}<div class="notice err" role="alert">{t('reg.paused')}. <button class="sm" onclick={() => live.beginRegistration()}>Neu registrieren</button> <button class="sm" onclick={() => live.setPaused(false)}>Trotzdem fortsetzen</button></div>{/if}
  {#if app.registration.ampel === 'gelb' && live.running}<div class="notice">Registrierung ungenau – Kontakte sind weniger zuverlässig.</div>{/if}
  {#if live.cmAssumed && live.running}<div class="notice">Wandmaße unbekannt: Toleranzen in cm beruhen auf einer angenommenen Wandhöhe von 240 cm. Maße im Wandprofil ergänzen verbessert die Genauigkeit.</div>{/if}

  <div class="stage" bind:this={center}>
    {#if !app.profile}
      <div class="empty big">{t('empty.noProfile')} <button class="primary" onclick={() => { app.page = 'start'; }}>Zum Setup</button></div>
    {:else}
      <div class="wall" class:small={s.cameraFocus && s.showCamera}>
        <WallMap holds={app.holds} aspekt={app.profile.aspekt} background={s.wallBackground === 'foto' ? app.rectBitmap : null} getState={live.renderState}
          showIds={s.showIds} showSkeleton={s.showSkeleton} showConf={s.showConf} debug={s.debug} swap={s.swapLeftRight} fpsOut={(f) => { renderFps = f; app.renderFps = f; }} />
        {#if app.holds.length === 0}<div class="empty over">{t('empty.noHolds')} <button onclick={() => { app.page = 'scan'; }}>Zum Scan</button></div>{/if}
        <div class="legend">{#each ['LH', 'RH', 'LF', 'RF'] as l (l)}<span><i style:background={limbColor[l as 'LH']} class:sq={l.endsWith('F')}></i>{l}</span>{/each}</div>
      </div>
      <div class="pip" class:focus={s.cameraFocus} style:display={s.showCamera && live.source ? 'block' : 'none'} style:left={s.cameraFocus ? '0' : pip.x + 'px'} style:top={s.cameraFocus ? '0' : pip.y + 'px'} style:width={s.cameraFocus ? '100%' : pip.w + 'px'} style:height={s.cameraFocus ? '100%' : 'auto'}>
        {#if !s.cameraFocus}<div class="grip" onpointerdown={pipDown} onpointermove={pipMove} onpointerup={() => (dragging = null)} role="presentation">Kamera {live.armLock ? '– Person anklicken' : ''}</div>{/if}
        <div class="vid" class:arm={live.armLock} bind:this={pipHost} onclick={pipClick} role="presentation"></div>
        <canvas bind:this={overlay} class="ov"></canvas>
      </div>
    {/if}
  </div>

  {#if live.regPhase === 'ecken' && live.regBitmap}
    <div class="modal" role="dialog" aria-modal="true" aria-label="Wand registrieren">
      <div class="dlg panel">
        <h2>Wand registrieren</h2><p class="muted">{live.regInfo}</p>
        <div style="flex:1;min-height:300px"><CornerPicker image={live.regBitmap} bind:corners={live.regCorners} /></div>
        <div class="row" style="margin-top:8px"><button class="primary" disabled={live.regCorners.length !== 4 || live.busy} onclick={() => live.finishRegistration()}>Registrieren</button><button onclick={() => live.cancelRegistration()}>{t('btn.cancel')}</button>
          <button class="sm" onclick={() => { live.regCorners = []; }}>Ecken zurücksetzen</button></div>
      </div>
    </div>
  {:else if live.regPhase === 'rechnet' || live.regPhase === 'aufnahme'}<div class="modal"><div class="dlg panel"><h2>{live.regPhase === 'aufnahme' ? 'Nehme Bild auf …' : 'Registriere (Bildabgleich) …'}</h2><progress></progress></div></div>{/if}
  {#if app.contentMode}<button class="exit sm" onclick={() => { app.contentMode = false; }}>Content-Modus beenden (C / Esc)</button>{/if}
  <span class="sr" aria-live="polite">{renderFps.toFixed(0)} FPS</span>
</div>

<style>
  .live { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 8px; gap: 8px; position: relative; } .live.content { padding: 0; background: #000; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 8px; }
  .stage { position: relative; flex: 1; min-height: 0; border: 1px solid var(--c-border); border-radius: var(--radius-2); overflow: hidden; background: #05070a; } .content .stage { border: none; border-radius: 0; }
  .wall { position: absolute; inset: 0; } .wall.small { inset: auto 12px 12px auto; width: 300px; height: 240px; z-index: 5; border: 1px solid var(--c-border); background: #05070a; }
  .pip { position: absolute; z-index: 4; background: #000; border: 1px solid var(--c-border); border-radius: 10px; overflow: hidden; box-shadow: var(--elev-2); resize: horizontal; min-width: 180px; max-width: 90%; }
  .pip.focus { border-radius: 0; border: none; resize: none; z-index: 1; } .grip { cursor: move; font-size: 12px; padding: 4px 8px; background: var(--c-surface2); color: var(--c-textMuted); user-select: none; }
  .vid { position: relative; background: #000; aspect-ratio: 16 / 9; } .pip.focus .vid { aspect-ratio: auto; height: 100%; } .vid.arm { cursor: crosshair; outline: 3px solid var(--c-warn); outline-offset: -3px; }
  .ov { position: absolute; left: 0; right: 0; bottom: 0; top: 24px; width: 100%; height: calc(100% - 24px); pointer-events: none; } .pip.focus .ov { top: 0; height: 100%; }
  .notice { padding: 8px 12px; border: 1px solid var(--c-warn); color: var(--c-warn); border-radius: var(--radius-2); background: color-mix(in srgb, var(--c-warn) 8%, transparent); } .notice.err { border-color: var(--c-error); color: var(--c-error); }
  .empty.big, .empty.over { margin: 24px; } .empty.over { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); background: var(--c-surface); z-index: 2; }
  .legend { position: absolute; left: 12px; bottom: 10px; display: flex; gap: 12px; font-size: 12px; background: rgba(5,7,10,.7); padding: 4px 10px; border-radius: 999px; } .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 4px; } .legend i.sq { border-radius: 2px; }
  .modal { position: absolute; inset: 0; z-index: 20; background: rgba(0,0,0,.65); display: flex; align-items: center; justify-content: center; padding: 24px; } .dlg { width: min(1100px, 100%); height: min(760px, 100%); display: flex; flex-direction: column; } .dlg:has(progress) { height: auto; width: 360px; }
  .exit { position: absolute; top: 8px; right: 8px; z-index: 30; opacity: .5; } .exit:hover { opacity: 1; } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; }
</style>
