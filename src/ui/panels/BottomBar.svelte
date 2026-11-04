<script lang="ts">
  import { app } from '../../app/state.svelte';
  import { live } from '../../app/live.svelte';
  import { editor, type Tool } from '../../app/editor.svelte';
  import { replay } from '../../app/replay.svelte';
  import { t } from '../../i18n';
  const TOOLS: [Tool, string, string, string][] = [['select', '↖', 'Auswählen', 'V'], ['add', '＋', 'Hinzufügen', 'A'], ['draw', '✎', 'Zeichnen', 'P'], ['split', '✂', 'Teilen', 'T'], ['vertex', '◇', 'Form', 'E']];
  const fmt = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((ms % 1000) / 100))}`;
  function fullscreen(): void { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); }
  async function shot(): Promise<void> { const b = await app.stageApi?.png(); if (!b) return; const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `climbvision-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`; a.click(); }
</script>

<div class="bar">
  {#if app.mode === 'live'}
    {#if !live.running}<button class="primary big" disabled={live.busy || !!app.modelProgress} onclick={() => live.start()}>▶ Starten</button>
    {:else}<button class="danger big" onclick={() => live.stop()}>■ Stoppen</button>{/if}
    {#if app.modelProgress}<span class="pill">Lade {app.modelProgress.name} (einmalig) … {Math.round(app.modelProgress.fraction * 100)} %</span>{/if}
    {#if live.running}<div class="sep"></div>
      <button class:on={live.armLock} onclick={() => { live.armLock = !live.armLock; }} title="L">{t('btn.lock')}</button><button onclick={() => live.unlockPerson()}>{t('btn.unlock')}</button>{/if}
    <span class="grow"></span>
    <button class="sm" onclick={shot}>Screenshot</button><button class="sm" onclick={fullscreen} title="F">Vollbild</button><button class="sm" onclick={() => { app.contentMode = true; }} title="C">Content-Modus</button>
  {:else if app.mode === 'edit'}
    {#each TOOLS as [k, ic, label, key] (k)}<button class="tool" class:on={editor.tool === k} title={`${label} (${key})`} onclick={() => editor.setTool(k)}><b>{ic}</b>{label}</button>{/each}
    <div class="sep"></div>
    <button class="tool" disabled={!editor.canUndo} onclick={() => editor.undo()} title="Strg+Z"><b>↶</b>Zurück</button><button class="tool" disabled={!editor.canRedo} onclick={() => editor.redo()} title="Strg+Y"><b>↷</b>Wiederholen</button>
    <div class="sep"></div>
    <button class="tool" disabled={editor.selected.size < 2} onclick={() => editor.mergeSelected()} title="M"><b>⊕</b>Verbinden</button>
    <button class="tool danger" disabled={!editor.selected.size} onclick={() => editor.deleteSelected()} title="Entf"><b>🗑</b>Löschen</button>
    <button class="tool" disabled={!editor.work.length} onclick={() => editor.renumber()}><b>№</b>Nummerieren</button>
    <span class="grow"></span><button class="sm" onclick={() => app.stageApi?.reset()}>Ansicht zurücksetzen</button>
  {:else}
    <button class="primary" disabled={!replay.rp} onclick={() => replay.toggle()}>{replay.playing ? '❚❚ Pause' : '▶ Abspielen'}</button>
    <button class="sm" disabled={!replay.rp} onclick={() => replay.step(-1)}>◀ Bild</button><button class="sm" disabled={!replay.rp} onclick={() => replay.step(1)}>Bild ▶</button>
    <input class="grow" type="range" min="0" max={replay.rp?.durationMs ?? 0} step="1" bind:value={replay.pos} oninput={() => (replay.playing = false)} aria-label="Zeitleiste" disabled={!replay.rp} />
    <span class="mono">{fmt(replay.pos)} / {fmt(replay.rp?.durationMs ?? 0)}</span>
    <select bind:value={replay.speed} aria-label="Geschwindigkeit" style="width:84px"><option value={0.1}>0,1×</option><option value={0.25}>0,25×</option><option value={0.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
    <button class="sm" disabled={!replay.rp} onclick={() => replay.exportVideo()}>Overlay-Video</button>
  {/if}
</div>
