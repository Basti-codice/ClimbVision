<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../../app/state.svelte';
  import type { TransportKind } from '../../app/esp32';
  import type { TransportStatus, VirtualLogEntry } from '../../transport/transports';
  import { DEFAULT_LIMB_COLORS, mappingFromCsv, mappingToCsv, serpentineMapping, CsvError } from '../../transport/mapping';
  import { LIMBS } from '../../core/schemas';
  import { autoNumber } from '../../holds/editor';
  import { limbColor } from '../../design/tokens';

  let kind = $state<TransportKind>('virtual'); let busy = $state(false); let st = $state<TransportStatus>(app.esp.status); let stopPattern = $state<(() => void) | null>(null);
  let log = $state<VirtualLogEntry[]>([]); let ledCanvas = $state<HTMLCanvasElement>(); let raf = 0; let filter = $state(''); let warn = $state<string[]>([]);
  const m = $derived(app.mapping);
  const connected = $derived(st.state === 'verbunden');
  const BLE = typeof navigator !== 'undefined' && 'bluetooth' in navigator, SER = typeof navigator !== 'undefined' && 'serial' in navigator;
  const mapped = $derived(Object.entries(m.map).map(([h, l]) => [Number(h), l] as [number, number]).filter(([h]) => !filter || String(h).includes(filter)).sort((a, b) => a[0] - b[0]));
  const unmapped = $derived(app.holds.filter((h) => !(h.id in m.map)).length);

  onMount(() => {
    app.esp.onStatus = (s) => { st = s; };
    const loop = (): void => { raf = requestAnimationFrame(loop); const v = app.esp.virtual; if (v) { if (log.length !== v.log.length) log = v.log.slice(-60); drawLeds(); } };
    raf = requestAnimationFrame(loop);
  });
  onDestroy(() => { cancelAnimationFrame(raf); stopPattern?.(); });

  function drawLeds(): void {
    const c = ledCanvas, v = app.esp.virtual; if (!c || !v) return; const n = m.ledCount, cols = Math.min(60, n), rows = Math.ceil(n / cols), s = 12;
    c.width = cols * s; c.height = rows * s; const g = c.getContext('2d') as CanvasRenderingContext2D; g.fillStyle = '#05070a'; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < n; i++) { g.fillStyle = '#1a2027'; g.beginPath(); g.arc((i % cols) * s + s / 2, Math.floor(i / cols) * s + s / 2, 3.5, 0, 7); g.fill(); }
    for (const p of v.leds) { g.fillStyle = `rgb(${p.rgb[0]},${p.rgb[1]},${p.rgb[2]})`; g.shadowColor = g.fillStyle; g.shadowBlur = 8; g.beginPath(); g.arc((p.led % cols) * s + s / 2, Math.floor(p.led / cols) * s + s / 2, 4.5, 0, 7); g.fill(); g.shadowBlur = 0; }
  }
  async function connect(): Promise<void> {
    busy = true;
    try { await app.esp.connect(kind, { url: app.settings.esp32Url }); app.toast(kind === 'virtual' ? 'Virtueller ESP32 verbunden.' : 'Verbunden.', 'ok'); }
    catch (e) { app.error(e); } finally { busy = false; }
  }
  function disconnect(): void { stopPattern?.(); stopPattern = null; app.esp.disconnect(); }
  function pattern(): void { if (stopPattern) { stopPattern(); stopPattern = null; return; } if (!Object.keys(m.map).length) return app.toast('Bitte zuerst ein Mapping anlegen.', 'warn'); stopPattern = app.esp.testPattern(); }
  async function save(): Promise<void> { await app.saveMapping(); app.esp.sendConfig(); }
  function setLed(h: number, l: number): void { app.mapping = { ...m, map: { ...m.map, [h]: Math.max(0, Math.min(m.ledCount - 1, l)) } }; void save(); }
  function auto(): void {
    const holds = autoNumber(app.holds); if (!holds.length) return app.toast('Keine Griffe vorhanden.', 'warn');
    const heights = holds.map((h) => h.bbox[3] - h.bbox[1]).sort((a, b) => a - b); const rowH = (heights[heights.length >> 1] as number) * 0.9; const rows: number[][] = []; let cy = -1;
    for (const h of [...holds].sort((a, b) => a.schwerpunkt[1] - b.schwerpunkt[1] || a.schwerpunkt[0] - b.schwerpunkt[0])) { if (!rows.length || h.schwerpunkt[1] - cy > rowH) { rows.push([h.id]); cy = h.schwerpunkt[1]; } else { (rows[rows.length - 1] as number[]).push(h.id); } }
    const byId = new Map(holds.map((h) => [h.id, h])); rows.forEach((r) => r.sort((a, b) => (byId.get(a)!.schwerpunkt[0]) - (byId.get(b)!.schwerpunkt[0])));
    const map = serpentineMapping(rows); app.mapping = { ...m, map, ledCount: Math.max(m.ledCount, Object.keys(map).length) }; void save(); app.toast(`${Object.keys(map).length} Griffe als Serpentine gemappt (Zeile 1 links→rechts, Zeile 2 rechts→links …). Bitte mit deiner Verkabelung vergleichen.`, 'ok', 10000);
  }
  function exportCsv(): void { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([mappingToCsv(m)], { type: 'text/csv' })); a.download = 'led-mapping.csv'; a.click(); }
  async function importCsv(e: Event): Promise<void> {
    const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
    try { const r = mappingFromCsv(await f.text(), m.ledCount); app.mapping = { ...m, map: r.map }; warn = r.warnungen; await save(); app.toast(`${Object.keys(r.map).length} Zuordnungen importiert.` + (r.warnungen.length ? ` ${r.warnungen.length} Warnung(en).` : ''), r.warnungen.length ? 'warn' : 'ok'); }
    catch (err) { app.toast(err instanceof CsvError ? err.message : String(err), 'err', 9000); } (e.target as HTMLInputElement).value = '';
  }
  const hexLimb = (l: string): string => m.colors[l as 'LH'];
</script>

<div class="page">
  <h1>ESP32-Ausgabe</h1>
  <p class="muted">Die erkannten Kontakte werden an einen ESP32 gesendet, der die LEDs der Wand ansteuert. Ohne Hardware kannst du den <b>virtuellen ESP32</b> nutzen. Hardware-Anbindungen (WLAN/BLE/USB) sind <b>nicht auf echter Hardware getestet</b>.</p>
  <div class="grid">
    <section class="panel">
      <h2>Verbindung</h2>
      <label for="k">Transport</label>
      <select id="k" bind:value={kind} disabled={connected}><option value="virtual">Virtueller ESP32 (Simulation)</option><option value="websocket">WLAN (WebSocket)</option><option value="ble" disabled={!BLE}>Bluetooth LE {BLE ? '' : '(nicht verfügbar – Chrome/Edge nötig)'}</option><option value="serial" disabled={!SER}>USB (Web Serial) {SER ? '' : '(nicht verfügbar – Chrome/Edge nötig)'}</option></select>
      {#if kind === 'websocket'}<label for="u">Adresse (IP-Adresse, kein „.local“ nötig)</label><input id="u" type="url" bind:value={app.settings.esp32Url} onchange={() => app.saveSettings()} placeholder="ws://192.168.4.1:81" />
        <p class="muted">Die Seite läuft auf <span class="mono">localhost</span>; WebSocket-Verbindungen ins lokale WLAN werden vom Browser dort zugelassen. Wird ClimbVision über https gehostet, blockiert der Browser ws:// (Mixed Content).</p>{/if}
      <div class="row" style="margin-top:12px">{#if !connected}<button class="primary" onclick={connect} disabled={busy}>Verbinden</button>{:else}<button class="danger" onclick={disconnect}>Trennen</button>{/if}
        <span class="badge" class:ok={connected} class:warn={st.state === 'wiederverbinde' || st.state === 'verbinde'} class:err={st.state === 'fehler'}>{st.state}</span>
        {#if st.latencyMs !== null}<span class="badge">Latenz {st.latencyMs} ms</span>{/if}{#if st.reconnects}<span class="badge">Reconnects {st.reconnects}</span>{/if}<span class="badge">gesendet {app.esp.sentCount}</span></div>
      {#if st.meldung}<p class="muted">{st.meldung}</p>{/if}
      <div class="row" style="margin-top:8px"><button class="sm" onclick={pattern} disabled={!connected} class:on={!!stopPattern}>Testmuster {stopPattern ? 'stoppen' : 'starten'}</button><button class="sm" onclick={() => app.esp.sendConfig()} disabled={!connected}>Konfiguration senden</button></div>
      <p class="muted">Gesendet wird nur bei Änderung, max. 20 Hz, Keepalive 1 Hz (Protokoll siehe docs/PROTOCOL.md).</p>
    </section>

    <section class="panel">
      <h2>Farben & Helligkeit</h2>
      <div class="row">{#each LIMBS as l (l)}<div><label for={'c' + l}>{l}</label><input id={'c' + l} type="color" value={hexLimb(l)} oninput={(e) => { app.mapping = { ...m, colors: { ...m.colors, [l]: (e.target as HTMLInputElement).value } }; }} onchange={save} style="width:56px;height:40px;padding:2px" /></div>{/each}
        <button class="sm" onclick={() => { app.mapping = { ...m, colors: { ...DEFAULT_LIMB_COLORS } }; void save(); }}>Standard</button></div>
      <label for="br">Helligkeit {m.brightness}</label><input id="br" type="range" min="5" max="255" value={m.brightness} oninput={(e) => { app.mapping = { ...m, brightness: Number((e.target as HTMLInputElement).value) }; }} onchange={save} />
      <label for="lc">Anzahl LEDs</label><input id="lc" type="number" min="1" max="4000" value={m.ledCount} onchange={(e) => { app.mapping = { ...m, ledCount: Math.max(1, Number((e.target as HTMLInputElement).value) || 300) }; void save(); }} />
    </section>

    {#if app.esp.virtual}
      <section class="panel wide"><h2>Virtueller ESP32</h2>
        <canvas bind:this={ledCanvas} class="leds" aria-label="LED-Streifen (simuliert)"></canvas>
        <div class="row"><div><label for="lat">Simulierte Latenz (ms)</label><input id="lat" type="number" min="0" max="2000" value={app.esp.virtual.latencyMs} onchange={(e) => { app.esp.virtual!.latencyMs = Number((e.target as HTMLInputElement).value) || 0; }} /></div>
          <div><label for="dr">Paketverlust (%)</label><input id="dr" type="number" min="0" max="100" value={app.esp.virtual.dropRate * 100} onchange={(e) => { app.esp.virtual!.dropRate = (Number((e.target as HTMLInputElement).value) || 0) / 100; }} /></div>
          <button class="sm" onclick={() => app.esp.virtual?.simulateDrop()}>Verbindung unterbrechen</button><button class="sm" onclick={() => app.esp.virtual?.simulateRecover()}>Wiederherstellen</button><span class="badge">verpasste seq: {app.esp.virtual.missed}</span></div>
        <div class="logbox mono" role="log" aria-label="Nachrichtenprotokoll">{#each log as e, i (i)}<div class={e.dir}><span>{e.dir === 'tx' ? '→' : '←'} {e.bytes} B</span> {e.text}</div>{/each}</div>
      </section>
    {/if}

    <section class="panel wide">
      <h2>Mapping: Griff → LED-Index</h2>
      <div class="row"><button class="sm" onclick={auto}>Automatisch (Serpentine)</button><button class="sm" onclick={exportCsv} disabled={!mapped.length}>CSV exportieren</button><label class="fb">CSV importieren<input type="file" accept=".csv,text/csv" hidden onchange={importCsv} /></label>
        <button class="sm danger" onclick={() => { app.mapping = { ...m, map: {} }; void save(); }} disabled={!mapped.length}>Leeren</button><input type="text" placeholder="Griff-ID filtern" bind:value={filter} style="width:140px" aria-label="Filter" />
        <span class="muted">{Object.keys(m.map).length} gemappt · {unmapped} Griffe ohne LED</span></div>
      {#if warn.length}<div class="notice">{#each warn as w, i (i)}<div>{w}</div>{/each}</div>{/if}
      {#if mapped.length === 0}<div class="empty" style="margin-top:8px">Noch kein Mapping. „Automatisch“ legt eine Serpentine an (typisch für LED-Streifen), oder CSV mit Kopf <span class="mono">holdId,led</span> importieren.</div>
      {:else}<div class="tbl">{#each mapped as [h, l] (h)}<label class="cell">#{h}<input type="number" min="0" max={m.ledCount - 1} value={l} onchange={(e) => setLed(h, Number((e.target as HTMLInputElement).value))} /></label>{/each}</div>{/if}
    </section>
  </div>
  <section class="panel" style="margin-top:12px"><h3>Legende</h3><div class="row">{#each LIMBS as l (l)}<span class="badge"><i style:background={limbColor[l]}></i> {l}</span>{/each}<span class="muted">Mehrere Gliedmaßen am selben Griff mischen additiv.</span></div></section>
</div>

<style>
  .page { padding: 20px; height: 100%; overflow: auto; } .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 12px; align-items: start; } .wide { grid-column: 1 / -1; }
  .leds { max-width: 100%; border: 1px solid var(--c-border); border-radius: 8px; margin-bottom: 8px; } .logbox { height: 170px; overflow: auto; background: #05070a; border: 1px solid var(--c-border); border-radius: 8px; padding: 6px; font-size: 12px; margin-top: 8px; }
  .logbox .tx { color: var(--c-accent); } .logbox .rx { color: var(--c-ok); } .logbox span { opacity: .6; margin-right: 6px; }
  .tbl { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 6px; margin-top: 8px; max-height: 340px; overflow: auto; } .cell { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--c-text); font-size: 13px; } .cell input { width: 72px; min-height: 30px; }
  .fb { display: inline-flex; align-items: center; padding: 0 12px; min-height: 34px; border: 1px solid var(--c-border); border-radius: var(--radius-2); cursor: pointer; margin: 0; color: var(--c-text); font-size: 13px; } .notice { padding: 8px; border: 1px solid var(--c-warn); color: var(--c-warn); border-radius: 8px; margin-top: 8px; font-size: 13px; }
  .badge i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
</style>
