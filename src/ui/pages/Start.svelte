<script lang="ts">
  import { onDestroy } from 'svelte';
  import { app } from '../../app/state.svelte';
  import { t } from '../../i18n';
  import CornerPicker from '../CornerPicker.svelte';
  import { CameraSource, listCameras, type CameraDevice } from '../../sources/camera';
  import { fileToRgba, medianFrames, rgbaToBlob, blobToBytes, rgbaToImageBitmap, bitmapToRgba } from '../../app/imageio';
  import { createProfile, estimateAspect, normalizedHomography, rectify, resolveAspect } from '../../app/wizard';
  import { downloadModel, MODELS, type ModelId } from '../../app/models';
  import { checkCornerQuad, type Vec2 } from '../../geometry/homography';
  import type { Rgba } from '../../image/raster';

  let step = $state(0); // 0 Übersicht, 1 Quelle & Foto, 2 Ecken, 3 Entzerrung, 4 Speichern
  let devices = $state<CameraDevice[]>([]); let deviceId = $state(''); let camW = $state(1280);
  let cam = $state<CameraSource | null>(null); let previewHost = $state<HTMLDivElement>();
  let image = $state<Rgba | null>(null); let bitmap = $state<ImageBitmap | null>(null);
  let corners = $state<Vec2[]>([]);
  let name = $state('Meine Wand'); let winkel = $state(15); let breite = $state<number | undefined>(); let hoehe = $state<number | undefined>(); let aspektManuell = $state<number | undefined>();
  let rectCanvas = $state<HTMLCanvasElement>(); let busy = $state(false); let dl = $state<Record<string, number>>({});
  let quadOk = $derived(corners.length === 4 && checkCornerQuad(corners, image?.width ?? 1, image?.height ?? 1).ok);
  let aspekt = $derived(corners.length === 4 ? resolveAspect({ breite_cm: breite, hoehe_cm: hoehe, manuell: aspektManuell, geschaetzt: estimateAspect(corners) }) : 1);

  onDestroy(() => cam?.stop());

  async function startCamera(): Promise<void> {
    try {
      cam?.stop(); cam = new CameraSource({ deviceId: deviceId || undefined, width: camW, maxFrameWidth: 2400 }); await cam.start();
      devices = await listCameras(); if (!deviceId && devices[0]) deviceId = devices[0].deviceId;
      const v = cam.element as HTMLVideoElement; v.style.width = '100%'; v.style.borderRadius = '10px'; previewHost?.replaceChildren(v);
      const i = cam.info(); app.toast(`Kamera aktiv: ${i.width}×${i.height}${i.fps ? ` @ ${Math.round(i.fps)} fps` : ''} (tatsächlich geliefert)`, 'ok');
    } catch (e) { app.error(e); }
  }
  async function capture(): Promise<void> {
    if (!cam?.element) return; busy = true;
    try {
      const v = cam.element; const frames: Rgba[] = [];
      for (let i = 0; i < 9; i++) { const b = await createImageBitmap(v); frames.push(await bitmapToRgba(b, 1920)); b.close(); await new Promise((r) => setTimeout(r, 90)); }
      setImage(medianFrames(frames)); cam.stop(); cam = null;
    } catch (e) { app.error(e); } finally { busy = false; }
  }
  async function pickFile(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; busy = true;
    try {
      if (f.type.startsWith('video/')) { // erstes Bild eines Videos als Wandfoto
        const url = URL.createObjectURL(f); const v = document.createElement('video'); v.muted = true; v.src = url;
        await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Das Video konnte nicht gelesen werden (MP4/H.264 oder WebM verwenden).')); });
        v.currentTime = 0.1; await new Promise<void>((r) => { v.onseeked = () => r(); });
        const b = await createImageBitmap(v); setImage(await bitmapToRgba(b, 2400)); b.close(); URL.revokeObjectURL(url);
      } else setImage(await fileToRgba(f, 2400));
    } catch (err) { app.error(err); } finally { busy = false; }
  }
  async function setImage(img: Rgba): Promise<void> { image = img; bitmap?.close(); bitmap = await rgbaToImageBitmap(img); corners = []; step = 2; }

  let rectTimer: number | undefined;
  $effect(() => {
    void corners; void aspekt; void image;
    if (step !== 3 || !image || !quadOk || !rectCanvas) return;
    clearTimeout(rectTimer);
    rectTimer = window.setTimeout(async () => {
      if (!image || !rectCanvas) return;
      const h = normalizedHomography(corners, image.width, image.height);
      const r = rectify(image, h, aspekt, 900);
      rectCanvas.width = r.width; rectCanvas.height = r.height;
      const ctx = rectCanvas.getContext('2d') as CanvasRenderingContext2D; ctx.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height), 0, 0);
      // Quadratraster zur Kontrolle (jede Zelle = gleiche Kantenlänge → Seitenverhältnis stimmt, wenn die Zellen quadratisch wirken)
      ctx.strokeStyle = 'rgba(124,196,255,.55)'; ctx.lineWidth = 1; const n = 10, cell = r.height / n;
      for (let i = 0; i <= Math.floor(r.width / cell); i++) { ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, r.height); ctx.stroke(); }
      for (let j = 0; j <= n; j++) { ctx.beginPath(); ctx.moveTo(0, j * cell); ctx.lineTo(r.width, j * cell); ctx.stroke(); }
    }, 80);
  });

  async function save(): Promise<void> {
    if (!image) return; busy = true;
    try {
      const id = crypto.randomUUID();
      const { profile, rect } = createProfile({ id, name: name.trim() || 'Meine Wand', winkel_grad: winkel, breite_cm: breite, hoehe_cm: hoehe, aspekt, image, cornersPx: corners, fotoBlobId: `${id}:foto`, rectBlobId: `${id}:rect`, now: new Date().toISOString() });
      await app.store.putBlob(profile.referenzfoto.blobId, 'image/jpeg', await blobToBytes(await rgbaToBlob(image, 'image/jpeg', 0.92)));
      await app.store.putBlob(profile.referenz_entzerrt.blobId, 'image/jpeg', await blobToBytes(await rgbaToBlob(rect, 'image/jpeg', 0.95)));
      await app.store.putProfile(profile); await app.store.putHolds({ schemaVersion: 1, typ: 'Holds', wandId: id, erstellt: new Date().toISOString(), griffe: [] });
      app.profiles = await app.store.listProfiles(); await app.selectProfile(id); app.trustReference();
      app.toast('Wandprofil gespeichert. Als Nächstes: Griffe scannen.', 'ok'); step = 0; app.page = 'scan';
    } catch (e) { app.error(e); } finally { busy = false; }
  }
  async function dlModel(id: ModelId): Promise<void> {
    try { const r = await downloadModel(app.store, id, (f) => { dl = { ...dl, [id]: f }; }); await app.refreshModels(); app.toast(`${MODELS[id].name} gespeichert und geprüft.` + (r.hashAbweichung ? ' Hinweis: Prüfsumme weicht von der dokumentierten ab.' : ''), r.hashAbweichung ? 'warn' : 'ok'); }
    catch (e) { app.error(e); }
  }
  async function dup(id: string): Promise<void> { try { const n = await app.store.duplicateProfile(id, crypto.randomUUID(), (app.profiles.find((p) => p.id === id)?.name ?? 'Wand') + ' (Kopie)'); app.profiles = await app.store.listProfiles(); app.toast(`„${n.name}“ angelegt.`, 'ok'); } catch (e) { app.error(e); } }
  async function del(id: string): Promise<void> { if (!confirm('Dieses Wandprofil samt Griffen, Routen und Sessions unwiderruflich löschen?')) return; await app.store.deleteProfile(id); app.profiles = await app.store.listProfiles(); if (app.profile?.id === id) { app.profile = null; app.holds = []; } }
  async function rename(id: string): Promise<void> { const p = app.profiles.find((x) => x.id === id); if (!p) return; const n = prompt('Neuer Name', p.name); if (!n) return; await app.store.putProfile({ ...p, name: n, geaendert: new Date().toISOString() }); app.profiles = await app.store.listProfiles(); if (app.profile?.id === id) await app.selectProfile(id); }
</script>

<div class="page">
  {#if step === 0}
    <h1>Start & Setup</h1>
    <p class="muted">{t('privacy')}</p>
    <div class="grid">
      <section class="panel">
        <h2>Wandprofile</h2>
        {#if app.profiles.length === 0}
          <div class="empty">{t('empty.noProfile')}</div>
        {:else}
          <div class="col">
            {#each app.profiles as p (p.id)}
              <div class="row prof" class:active={app.profile?.id === p.id}>
                <div class="grow"><b>{p.name}</b><div class="muted">{p.winkel_grad}° · {p.breite_cm && p.hoehe_cm ? `${p.breite_cm}×${p.hoehe_cm} cm` : `Seitenverhältnis ${p.aspekt.toFixed(2)}`}</div></div>
                <button class="sm" onclick={() => app.selectProfile(p.id)} disabled={app.profile?.id === p.id}>{app.profile?.id === p.id ? 'Aktiv' : 'Laden'}</button>
                <button class="sm" onclick={() => rename(p.id)}>Umbenennen</button>
                <button class="sm" onclick={() => dup(p.id)}>Duplizieren</button>
                <button class="sm danger" onclick={() => del(p.id)}>{t('btn.delete')}</button>
              </div>
            {/each}
          </div>
        {/if}
        <div class="row" style="margin-top:12px"><button class="primary" onclick={() => { step = 1; }}>Neue Wand einrichten</button></div>
      </section>

      <section class="panel">
        <h2>Modelle (einmaliger Download)</h2>
        <p class="muted">Die Modelle werden einmal geladen, geprüft (SHA-256) und lokal gespeichert. Danach läuft alles offline.</p>
        <div class="col">
          {#each Object.values(MODELS).filter((m) => m.id !== 'pose_heavy') as m (m.id)}
            <div class="row">
              <div class="grow"><b>{m.name}</b> <span class="muted">{(m.bytes / 1e6).toFixed(1)} MB · {m.hinweis}</span></div>
              {#if app.modelsCached[m.id]}<span class="badge ok">gespeichert</span>
              {:else if dl[m.id] !== undefined && dl[m.id]! < 1}<progress value={dl[m.id]} max="1"></progress>
              {:else}<button class="sm" onclick={() => dlModel(m.id)}>Herunterladen</button>{/if}
            </div>
          {/each}
        </div>
      </section>
    </div>
  {:else}
    <div class="row"><button class="sm" onclick={() => { cam?.stop(); cam = null; step = Math.max(0, step - 1); }}>← Zurück</button>
      <ol class="steps">{#each ['Quelle & Foto', 'Ecken', 'Entzerrung', 'Speichern'] as s, i (s)}<li class:on={step === i + 1} class:done={step > i + 1}>{i + 1}. {s}</li>{/each}</ol></div>

    {#if step === 1}
      <section class="panel">
        <h2>1 · Kamera oder Datei wählen und leere Wand fotografieren</h2>
        <p class="muted">Pixel 7a: Handy per USB anschließen, Android: Einstellungen → Verbundene Geräte → USB → <b>Webcam</b>. Alternativ ein Foto/Video der leeren Wand laden.</p>
        <div class="row">
          <div style="min-width:260px"><label for="cam">Kamera</label>
            <select id="cam" bind:value={deviceId} onfocus={async () => { devices = await listCameras(); }}>
              <option value="">Standard</option>{#each devices as d (d.deviceId)}<option value={d.deviceId}>{d.label}</option>{/each}</select></div>
          <div style="width:160px"><label for="res">Gewünschte Breite</label><select id="res" bind:value={camW}><option value={1920}>1920 (Full HD)</option><option value={1280}>1280 (HD)</option><option value={640}>640</option></select></div>
          <button class="primary" onclick={startCamera}>Kamera starten</button>
          <span class="muted">oder</span>
          <label class="filebtn"><input type="file" accept="image/*,video/*" onchange={pickFile} hidden />Foto/Video wählen</label>
        </div>
        <div bind:this={previewHost} style="margin-top:12px;max-width:760px"></div>
        {#if cam}<div class="row" style="margin-top:8px"><button class="primary" disabled={busy} onclick={capture}>{busy ? 'Nehme auf …' : 'Leere Wand fotografieren'}</button><span class="muted">Es werden 9 Bilder gemittelt (entfernt Rauschen und vorbeilaufende Personen).</span></div>{/if}
      </section>
    {:else if step === 2 && bitmap}
      <section class="panel tall"><h2>2 · Die vier Wandecken markieren</h2>
        <div class="fill"><CornerPicker image={bitmap} bind:corners /></div>
        <div class="row" style="margin-top:8px"><button class="sm" onclick={() => { corners = []; }}>Zurücksetzen</button>
          <button class="primary" disabled={!quadOk} onclick={() => { step = 3; }}>Weiter: Entzerren</button>
          {#if corners.length === 4 && !quadOk}<span class="badge err">Ecken ungültig – Reihenfolge links oben → rechts oben → rechts unten → links unten</span>{/if}</div>
      </section>
    {:else if step === 3 && image}
      <section class="panel"><h2>3 · Entzerrte Wand prüfen</h2>
        <div class="row" style="align-items:flex-start">
          <div class="grow"><canvas bind:this={rectCanvas} class="rect" aria-label="Entzerrte Wand mit Quadratraster"></canvas><p class="muted">Das Raster besteht aus Quadraten. Wirken Griffreihen und Wandkanten gerade und die Zellen quadratisch, stimmt das Seitenverhältnis.</p></div>
          <div style="width:280px">
            <label for="n">Name</label><input id="n" type="text" bind:value={name} />
            <label for="w">Wandwinkel (Grad, 0 = senkrecht)</label><input id="w" type="number" bind:value={winkel} min="-30" max="90" />
            <div class="row"><div style="flex:1"><label for="b">Breite (cm)</label><input id="b" type="number" bind:value={breite} min="10" placeholder="optional" /></div>
              <div style="flex:1"><label for="h">Höhe (cm)</label><input id="h" type="number" bind:value={hoehe} min="10" placeholder="optional" /></div></div>
            <label for="a">Seitenverhältnis B/H {breite && hoehe ? '(aus Maßen)' : ''}</label>
            <input id="a" type="number" step="0.01" disabled={!!(breite && hoehe)} value={aspektManuell ?? Number(aspekt.toFixed(3))} oninput={(e) => { aspektManuell = Number((e.target as HTMLInputElement).value) || undefined; }} />
            <p class="muted">Geschätzt: {estimateAspect(corners).toFixed(2)}. Maße in cm verbessern auch die Toleranzen der Kontaktlogik.</p>
            <button class="primary" onclick={() => { step = 4; }}>Weiter</button>
          </div></div>
      </section>
    {:else if step === 4}
      <section class="panel"><h2>4 · Wandprofil speichern</h2>
        <p>„{name}“ · {winkel}° · Seitenverhältnis {aspekt.toFixed(2)}. Das Referenzfoto und die entzerrte Wand werden lokal gespeichert.</p>
        <button class="primary" disabled={busy} onclick={save}>{busy ? 'Speichere …' : 'Wandprofil speichern & Griffe scannen'}</button></section>
    {/if}
  {/if}
</div>

<style>
  .page { padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-4); height: 100%; overflow: auto; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: var(--space-4); align-items: start; }
  .prof { padding: 8px; border: 1px solid var(--c-border); border-radius: var(--radius-2); } .prof.active { border-color: var(--c-accent); }
  .steps { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; } .steps li { padding: 4px 10px; border-radius: 999px; border: 1px solid var(--c-border); color: var(--c-textMuted); font-size: 13px; }
  .steps li.on { border-color: var(--c-accent); color: var(--c-text); } .steps li.done { color: var(--c-ok); }
  .filebtn { display: inline-flex; align-items: center; min-height: var(--tap); padding: 0 16px; border: 1px solid var(--c-border); border-radius: var(--radius-2); cursor: pointer; background: var(--c-surface2); margin: 0; color: var(--c-text); font-size: 15px; }
  .tall { flex: 1; min-height: 480px; display: flex; flex-direction: column; } .fill { flex: 1; min-height: 360px; }
  .rect { max-width: 100%; max-height: 62vh; border: 1px solid var(--c-border); border-radius: 8px; }
  progress { width: 140px; }
</style>
