<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../app/state.svelte';
  import { editor } from '../app/editor.svelte';
  import CornerPicker from './CornerPicker.svelte';
  import { CameraSource, listCameras, type CameraDevice } from '../sources/camera';
  import { fileToRgba, medianFrames, rgbaToBlob, blobToBytes, rgbaToImageBitmap, bitmapToRgba } from '../app/imageio';
  import { createProfile, estimateAspect, normalizedHomography, rectify, resolveAspect } from '../app/wizard';
  import { checkCornerQuad, type Vec2 } from '../geometry/homography';
  import type { Rgba } from '../image/raster';

  let step = $state(1); // 1 Foto, 2 Ecken, 3 Prüfen
  let devices = $state<CameraDevice[]>([]); let deviceId = $state('');
  let cam = $state<CameraSource | null>(null); let previewHost = $state<HTMLDivElement>();
  let image = $state.raw<Rgba | null>(null); let bitmap = $state.raw<ImageBitmap | null>(null);
  let corners = $state<Vec2[]>([]);
  let name = $state(`Wand ${app.profiles.length + 1}`); let breite = $state<number | undefined>(); let hoehe = $state<number | undefined>(); let aspektManuell = $state<number | undefined>();
  let rectCanvas = $state<HTMLCanvasElement>(); let busy = $state(false); let drop = $state(false);
  const quadOk = $derived(corners.length === 4 && checkCornerQuad(corners, image?.width ?? 1, image?.height ?? 1).ok);
  const aspekt = $derived(corners.length === 4 ? resolveAspect({ breite_cm: breite, hoehe_cm: hoehe, manuell: aspektManuell, geschaetzt: estimateAspect(corners) }) : 1);
  onDestroy(() => cam?.stop());

  async function startCamera(): Promise<void> {
    try {
      cam?.stop(); cam = new CameraSource({ deviceId: deviceId || undefined, width: 1920, maxFrameWidth: 2400 }); await cam.start();
      devices = await listCameras(); if (!deviceId && devices[0]) deviceId = devices[0].deviceId;
      const v = cam.element as HTMLVideoElement; v.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:10px;background:#000'; previewHost?.replaceChildren(v);
    } catch (e) { app.error(e); }
  }
  async function capture(): Promise<void> {
    if (!cam?.element) return; busy = true;
    try {
      const frames: Rgba[] = []; for (let i = 0; i < 9; i++) { const b = await createImageBitmap(cam.element); frames.push(await bitmapToRgba(b, 1920)); b.close(); await new Promise((r) => setTimeout(r, 90)); }
      await setImage(medianFrames(frames)); cam.stop(); cam = null;
    } catch (e) { app.error(e); } finally { busy = false; }
  }
  async function loadFile(f: File): Promise<void> {
    busy = true;
    try {
      if (f.type.startsWith('video/')) {
        const url = URL.createObjectURL(f); const v = document.createElement('video'); v.muted = true; v.src = url;
        await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Das Video konnte nicht gelesen werden (MP4/H.264 oder WebM verwenden).')); });
        v.currentTime = 0.1; await new Promise<void>((r) => { v.onseeked = () => r(); });
        const b = await createImageBitmap(v); await setImage(await bitmapToRgba(b, 2400)); b.close(); URL.revokeObjectURL(url);
      } else await setImage(await fileToRgba(f, 2400));
    } catch (err) { app.error(err); } finally { busy = false; }
  }
  async function setImage(img: Rgba): Promise<void> { image = img; bitmap?.close(); bitmap = await rgbaToImageBitmap(img); corners = []; step = 2; }
  function onDrop(e: DragEvent): void { e.preventDefault(); drop = false; const f = e.dataTransfer?.files?.[0]; if (f) void loadFile(f); }

  let rectTimer: number | undefined;
  $effect(() => {
    void corners; void aspekt; void image;
    if (step !== 3 || !image || !quadOk || !rectCanvas) return;
    clearTimeout(rectTimer);
    rectTimer = window.setTimeout(() => {
      if (!image || !rectCanvas) return;
      const r = rectify(image, normalizedHomography(corners, image.width, image.height), aspekt, 900);
      rectCanvas.width = r.width; rectCanvas.height = r.height;
      const ctx = rectCanvas.getContext('2d') as CanvasRenderingContext2D; ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      ctx.strokeStyle = 'rgba(124,196,255,.5)'; ctx.lineWidth = 1; const n = 10, cell = r.height / n;
      for (let i = 0; i <= Math.floor(r.width / cell); i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, r.height); ctx.stroke(); }
      for (let j = 0; j <= n; j++) { ctx.beginPath(); ctx.moveTo(0, j * cell); ctx.lineTo(r.width, j * cell); ctx.stroke(); }
    }, 80);
  });

  async function save(): Promise<void> {
    if (!image) return; busy = true;
    try {
      const id = crypto.randomUUID();
      const { profile, rect } = createProfile({ id, name: name.trim() || 'Meine Wand', winkel_grad: 0, breite_cm: breite, hoehe_cm: hoehe, aspekt, image, cornersPx: corners, fotoBlobId: `${id}:foto`, rectBlobId: `${id}:rect`, now: new Date().toISOString() });
      await app.store.putBlob(profile.referenzfoto.blobId, 'image/jpeg', await blobToBytes(await rgbaToBlob(image, 'image/jpeg', 0.92)));
      await app.store.putBlob(profile.referenz_entzerrt.blobId, 'image/jpeg', await blobToBytes(await rgbaToBlob(rect, 'image/jpeg', 0.95)));
      await app.store.putProfile(profile); await app.store.putHolds({ schemaVersion: 1, typ: 'Holds', wandId: id, erstellt: new Date().toISOString(), griffe: [] });
      app.profiles = await app.store.listProfiles(); await app.selectProfile(id); app.trustReference();
      cam?.stop(); app.mode = 'edit'; editor.load(); void editor.scan(); // direkt weiter: Griffe automatisch erkennen
    } catch (e) { app.error(e); } finally { busy = false; }
  }
</script>

<div class="wiz">
  <div class="row" style="margin-bottom:12px">
    <h1 style="margin:0">Neue Wand einrichten</h1>
    <ol class="steps">{#each ['Foto', 'Ecken', 'Prüfen'] as l, i (l)}<li class:on={step === i + 1} class:done={step > i + 1}>{i + 1}. {l}</li>{/each}</ol>
    <span class="grow"></span>
    {#if app.profile}<button class="sm" onclick={() => { cam?.stop(); app.mode = 'live'; }}>Abbrechen</button>{/if}
  </div>

  {#if step === 1}
    <div class="two">
      <section class="card" style="display:flex;flex-direction:column;gap:8px">
        <h3>Foto der leeren Wand</h3>
        <p class="muted" style="margin:0">Stelle die Kamera genau dorthin, wo sie später steht (Stativ, frontal zur Wand) – und lass sie dort. Dann findet die Software die Wand später von selbst.</p>
        <label for="cam">Kamera</label>
        <select id="cam" bind:value={deviceId} onfocus={async () => { devices = await listCameras(); }}><option value="">Standard</option>{#each devices as d (d.deviceId)}<option value={d.deviceId}>{d.label}</option>{/each}</select>
        <button class="primary" onclick={startCamera}>Kamera starten</button>
        {#if cam}<button class="primary" disabled={busy} onclick={capture}>{busy ? 'Nehme auf …' : '📸 Wand fotografieren'}</button>{/if}
        <p class="muted" style="font-size:12px;margin:0">Pixel 7a: Handy per USB anschließen → Android: USB-Einstellungen → „Webcam“.</p>
      </section>
      <section class="card drop" class:over={drop} ondragover={(e) => { e.preventDefault(); drop = true; }} ondragleave={() => (drop = false)} ondrop={onDrop} role="presentation">
        {#if cam}<div bind:this={previewHost} style="width:100%;height:100%;min-height:260px"></div>
        {:else}<div class="cta"><div style="font-size:40px">🖼</div><b>Foto oder Video hierher ziehen</b><span class="muted">oder</span>
          <label class="filebtn"><input type="file" accept="image/*,video/*" hidden onchange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void loadFile(f); }} />Datei wählen …</label></div>{/if}
      </section>
    </div>
  {:else if step === 2 && bitmap}
    <section class="card" style="flex:1;min-height:0;display:flex;flex-direction:column">
      <h3>Die vier Wandecken markieren (Reihenfolge: links oben → rechts oben → rechts unten → links unten)</h3>
      <div style="flex:1;min-height:340px"><CornerPicker image={bitmap} bind:corners /></div>
      <div class="row" style="margin-top:8px"><button class="sm" onclick={() => { corners = []; }}>Zurücksetzen</button><button class="sm" onclick={() => { step = 1; }}>← Anderes Foto</button><span class="grow"></span>
        {#if corners.length === 4 && !quadOk}<span class="badge err">Ecken ungültig – Reihenfolge prüfen</span>{/if}
        <button class="primary" disabled={!quadOk} onclick={() => { step = 3; }}>Weiter</button></div>
    </section>
  {:else if step === 3 && image}
    <div class="two" style="grid-template-columns:minmax(0,1fr) 300px;min-height:0;flex:1">
      <section class="card" style="display:flex;flex-direction:column;min-height:0"><h3>So sieht die entzerrte Wand aus</h3>
        <div style="flex:1;min-height:0;display:grid;place-items:center"><canvas bind:this={rectCanvas} style="max-width:100%;max-height:100%;border:1px solid var(--c-border);border-radius:8px" aria-label="Entzerrte Wand"></canvas></div>
        <p class="muted" style="font-size:12px;margin:8px 0 0">Wirken Griffreihen und Kanten gerade und die Rasterzellen quadratisch, stimmt alles.</p></section>
      <section class="card"><h3>Fertigstellen</h3>
        <label for="n">Name</label><input id="n" type="text" bind:value={name} />
        <details style="margin-top:10px"><summary class="muted" style="cursor:pointer">Optional: Maße</summary>
          <p class="muted" style="font-size:12px">Nur nötig für Zentimeter-Angaben (Toleranzen, Spannweite). Ohne Maße rechnet die Software mit einer typischen Wandhöhe. Maße müssen genau für das Rechteck zwischen den vier Ecken gelten.</p>
          <div class="row"><div style="flex:1"><label for="b">Breite (cm)</label><input id="b" type="number" min="10" bind:value={breite} /></div><div style="flex:1"><label for="h">Höhe (cm)</label><input id="h" type="number" min="10" bind:value={hoehe} /></div></div>
          {#if !(breite && hoehe)}<label for="a">Seitenverhältnis (Breite/Höhe)</label><input id="a" type="number" step="0.01" value={aspektManuell ?? Number(aspekt.toFixed(3))} oninput={(e) => { aspektManuell = Number((e.target as HTMLInputElement).value) || undefined; }} />{/if}</details>
        <div class="row" style="margin-top:14px"><button class="sm" onclick={() => { step = 2; }}>← Zurück</button><button class="primary grow" disabled={busy} onclick={save}>{busy ? 'Speichere …' : 'Speichern & Griffe erkennen'}</button></div>
      </section>
    </div>
  {/if}
</div>

<style>
  .wiz { height: 100%; padding: 16px 20px; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
  .two { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 14px; min-height: 0; flex: 1; }
  .drop { display: grid; place-items: center; min-height: 300px; border-style: dashed; } .drop.over { border-color: var(--c-accent); background: color-mix(in srgb, var(--c-accent) 8%, var(--c-surface2)); }
  .steps { display: flex; gap: 6px; list-style: none; margin: 0 0 0 10px; padding: 0; } .steps li { padding: 3px 12px; border: 1px solid var(--c-border); border-radius: 999px; color: var(--c-textMuted); font-size: 13px; } .steps li.on { border-color: var(--c-accent); color: var(--c-text); } .steps li.done { color: var(--c-ok); }
  .filebtn { display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 18px; border: 1px solid var(--c-border); border-radius: var(--radius-2); cursor: pointer; background: var(--c-surface); color: var(--c-text); margin: 0; font-size: 15px; }
  @media (max-width: 900px) { .two { grid-template-columns: 1fr !important; } }
</style>
