<script lang="ts">
  import { app } from '../app/state.svelte';
  import { live } from '../app/live.svelte';
  import { editor } from '../app/editor.svelte';
  import { replay } from '../app/replay.svelte';
  import WallMap from './WallMap.svelte';
  import type { WallPointer } from './wallTypes';
  import type { Hold } from '../core/schemas';

  let map = $state<ReturnType<typeof WallMap>>();
  let { fps = $bindable(0) }: { fps?: number } = $props();
  const s = $derived(app.settings);
  const p = $derived(app.profile);
  const videoProp = $derived(s.wallBackground === 'live' && live.source?.element && app.registration.h ? { element: live.source.element, h: app.registration.h as never, opacity: s.videoOpacity } : undefined);
  const photoBg = $derived(app.mode === 'live' || app.mode === 'replay' ? (s.wallBackground === 'dunkel' ? null : app.rectBitmap) : app.rectBitmap);
  const holds = $derived<Hold[]>(app.mode === 'edit' ? editor.work : app.holds);
  const fills = $derived(app.mode === 'replay' ? replay.fills : undefined);
  const onwall = (e: WallPointer): void => {
    if (app.mode === 'edit') editor.onwall(e);
    else if (app.mode === 'replay') replay.onwall(e);
    else if (app.mode === 'live' && live.armLock && e.type === 'down' && e.button === 0) { live.lockAtWall(e.u, e.v); app.toast('Person wird gesperrt …', 'info', 2000); }
  };
  const interactive = $derived(app.mode === 'edit' || (app.mode === 'replay' && replay.editRoute) || (app.mode === 'live' && live.armLock));
  // schwebende Auswahl-Leiste (Editor)
  const selPos = $derived.by(() => { void editor.version; const h = editor.single; if (app.mode !== 'edit' || !h || !map) return null; const [x, y] = map.project((h.bbox[0] + h.bbox[2]) / 2, h.bbox[1]); return { x, y }; });
  $effect(() => { app.stageApi = { focus: (u, v, z) => map?.focus(u, v, z), reset: () => map?.resetView(), png: () => (map ? map.toPng() : Promise.resolve(null)), canvas: () => (map ? map.element() : null), project: (u, v) => (map ? map.project(u, v) : [0, 0]), zoom: () => (map ? map.zoomLevel() : 1) }; });
</script>

<div class="stage">
  <div class="map">
    {#if p}
      <WallMap bind:this={map} {holds} aspekt={p.aspekt} background={photoBg} backgroundDim={app.mode === 'edit' ? 0.12 : 0.5} video={app.mode === 'live' ? videoProp : undefined}
        getState={app.mode === 'live' ? live.renderState : app.mode === 'replay' ? replay.frameState : undefined}
        showIds={s.showIds} showSkeleton={s.showSkeleton} showConf={s.showConf} debug={s.debug} swap={s.swapLeftRight}
        selected={app.mode === 'edit' ? editor.selected : undefined} overlay={app.mode === 'edit' ? editor.overlay : app.mode === 'replay' ? replay.overlay : undefined}
        onwall={interactive ? onwall : undefined} staticVersion={app.mode === 'edit' ? editor.version : replay.version} fpsOut={(f) => { fps = f; app.renderFps = f; }}
        fillColors={fills} cursor={app.mode === 'edit' ? (editor.tool === 'select' ? 'default' : 'crosshair') : live.armLock ? 'crosshair' : 'default'} />
    {/if}
  </div>

  {#if app.mode === 'live' && p}
    {#if !live.source}
      <div class="float" style="left:50%;top:14px;transform:translateX(-50%)"><div class="pill">Öffne links eine Kamera oder Videodatei – das Live-Bild erscheint direkt auf der Wand.</div></div>
    {/if}
    {#if live.armLock}<div class="float" style="left:50%;top:14px;transform:translateX(-50%)"><div class="pill" style="border-color:var(--c-warn)">Klicke auf der Wand auf den Kletterer, um ihn zu sperren</div></div>{/if}
    {#if live.paused}<div class="float" style="left:50%;top:14px;transform:translateX(-50%)"><div class="pill" style="border-color:var(--c-error);color:var(--c-error)">Kamera bewegt – Zuordnung pausiert. <button class="sm" onclick={() => live.autoRegister()}>Neu ausrichten</button></div></div>{/if}
    <div class="float" style="left:12px;bottom:12px;display:flex;gap:8px"><span class="pill mono">{fps.toFixed(0)} FPS</span>{#if app.stats}<span class="pill mono">Pose {app.stats.poseHz.toFixed(0)} Hz</span>{/if}{#if live.recording}<span class="pill" style="color:var(--c-error)">● Aufnahme</span>{/if}</div>
  {/if}

  {#if app.mode === 'edit' && p}
    {#if selPos}
      <div class="float pill" style:left="{selPos.x}px" style:top="{Math.max(8, selPos.y - 52)}px" style="transform:translateX(-50%);display:flex;gap:4px;padding:4px">
        <button class="sm" onclick={() => editor.setTool('split')} title="Teilen (T)">Teilen</button>
        <button class="sm" onclick={() => editor.setTool('vertex')} title="Form bearbeiten (E)">Form</button>
        <button class="sm danger" onclick={() => editor.deleteSelected()} title="Entf">Löschen</button>
      </div>
    {/if}
    {#if editor.scanning}
      <div class="overlay-card"><div class="card"><h2>Griffe werden erkannt …</h2><progress value={editor.progress} max="1" style="width:100%"></progress><p class="muted">{editor.step}</p><button class="sm" onclick={() => editor.abortScan()}>Abbrechen</button></div></div>
    {:else if editor.work.length === 0}
      <div class="overlay-card"><div class="cta card"><h2>Noch keine Griffe</h2><p class="muted">Die Erkennung findet die Griffe automatisch. Danach korrigierst du nur noch, was nicht stimmt.</p><button class="primary big" onclick={() => editor.scan()}>Griffe jetzt erkennen</button></div></div>
    {/if}
    <div class="float" style="left:12px;bottom:12px"><span class="pill">{editor.tool === 'select' ? 'Griff anklicken · auf leere Fläche ziehen = Bereich markieren' : editor.tool === 'add' ? 'Klick auf einen fehlenden Griff = hinzufügen' : editor.tool === 'draw' ? 'Eckpunkte klicken, Doppelklick schließt' : editor.tool === 'split' ? 'Linie über einen Griff ziehen' : 'Punkte ziehen · Doppelklick auf Kante = Punkt'} · Mausrad zoomt · rechte Taste verschiebt</span></div>
  {/if}

  {#if app.mode === 'replay' && p && !replay.cur}
    <div class="float" style="left:50%;top:14px;transform:translateX(-50%)"><div class="pill">Wähle links eine Aufnahme.</div></div>
  {/if}
</div>

<style>
  .stage { height: 100%; }
</style>
