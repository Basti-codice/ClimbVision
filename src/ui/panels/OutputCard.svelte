<script lang="ts">
  import { app } from '../../app/state.svelte';
  import type { TransportKind } from '../../app/esp32';
  let kind = $state<TransportKind>('websocket'); let st = $state(app.esp.status); let busy = $state(false);
  $effect(() => { app.esp.onStatus = (x) => { st = x; }; });
  const BLE = 'bluetooth' in navigator, SER = 'serial' in navigator;
  const connected = $derived(st.state === 'verbunden');
  async function connect(): Promise<void> { busy = true; try { await app.esp.connect(kind, { url: app.settings.esp32Url }); } catch (e) { app.error(e); } finally { busy = false; } }
</script>

<section class="card"><h3>Ausgabe (ESP32) <span class="dot" class:ok={connected} class:warn={st.state === 'verbinde' || st.state === 'wiederverbinde'} class:err={st.state === 'fehler'}></span></h3>
  <p class="muted" style="font-size:12px;margin:0 0 8px">Schnittstelle: Die Software sendet die aktuellen Griffe je Hand/Fuß, sobald eine Verbindung besteht. Format: docs/PROTOCOL.md.</p>
  {#if !connected}
    <select bind:value={kind} aria-label="Verbindungsart"><option value="websocket">WLAN (WebSocket)</option><option value="ble" disabled={!BLE}>Bluetooth LE</option><option value="serial" disabled={!SER}>USB (seriell)</option></select>
    {#if kind === 'websocket'}<input type="url" style="margin-top:6px" bind:value={app.settings.esp32Url} onchange={() => app.saveSettings()} aria-label="Adresse" placeholder="ws://192.168.4.1:81" />{/if}
    <button style="width:100%;margin-top:6px" disabled={busy} onclick={connect}>Verbinden</button>
    {#if st.meldung}<p class="muted" style="font-size:12px">{st.meldung}</p>{/if}
  {:else}
    <div class="kv"><span>Status</span><b>verbunden</b>{#if st.latencyMs !== null}<span>Latenz</span><b>{st.latencyMs} ms</b>{/if}<span>Gesendet</span><b>{app.esp.sentCount}</b></div>
    <button class="sm danger" style="margin-top:8px" onclick={() => app.esp.disconnect()}>Trennen</button>
  {/if}
</section>
