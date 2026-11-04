<script lang="ts">
  import { onMount } from 'svelte';
  import type { Vec2 } from '../geometry/homography';
  import { color } from '../design/tokens';

  interface Props { image: ImageBitmap; corners: Vec2[]; onchange?: (c: Vec2[]) => void; hint?: string }
  let { image, corners = $bindable(), onchange, hint = '' }: Props = $props();
  const NAMES = ['Links oben', 'Rechts oben', 'Rechts unten', 'Links unten'];
  let canvas: HTMLCanvasElement; let wrap: HTMLDivElement; let W = 0, H = 0;
  let sel = $state(-1); let hover: Vec2 | null = null; let drag = -1;

  const fit = (): { s: number; ox: number; oy: number } => { const s = Math.min(W / image.width, H / image.height); return { s, ox: (W - image.width * s) / 2, oy: (H - image.height * s) / 2 }; };
  const toImg = (px: number, py: number): Vec2 => { const f = fit(); return [(px - f.ox) / f.s, (py - f.oy) / f.s]; };
  const toScr = (p: Vec2): Vec2 => { const f = fit(); return [p[0] * f.s + f.ox, p[1] * f.s + f.oy]; };

  function draw(): void {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    const f = fit(); ctx.drawImage(image, f.ox, f.oy, image.width * f.s, image.height * f.s);
    if (corners.length) {
      ctx.lineWidth = 2; ctx.strokeStyle = color.accent; ctx.fillStyle = 'rgba(124,196,255,0.10)'; ctx.beginPath();
      corners.forEach((c, i) => { const [x, y] = toScr(c); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      if (corners.length === 4) ctx.closePath(); ctx.stroke(); if (corners.length === 4) ctx.fill();
      corners.forEach((c, i) => {
        const [x, y] = toScr(c); ctx.beginPath(); ctx.arc(x, y, i === sel ? 9 : 7, 0, Math.PI * 2); ctx.fillStyle = i === sel ? color.warn : color.accent; ctx.fill(); ctx.strokeStyle = '#05070a'; ctx.stroke();
        ctx.fillStyle = '#04121d'; ctx.font = '700 11px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), x, y + 0.5);
      });
    }
    // Lupe
    const focus = drag >= 0 ? corners[drag] : sel >= 0 ? corners[sel] : hover;
    if (focus) {
      const z = 5, r = 70, lx = W - r * 2 - 12, ly = 12; ctx.save(); ctx.beginPath(); ctx.rect(lx, ly, r * 2, r * 2); ctx.clip();
      ctx.fillStyle = '#000'; ctx.fillRect(lx, ly, r * 2, r * 2);
      ctx.drawImage(image, focus[0] - r / z, focus[1] - r / z, (r * 2) / z, (r * 2) / z, lx, ly, r * 2, r * 2);
      ctx.strokeStyle = color.warn; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(lx + r, ly); ctx.lineTo(lx + r, ly + r * 2); ctx.moveTo(lx, ly + r); ctx.lineTo(lx + r * 2, ly + r); ctx.stroke(); ctx.restore();
      ctx.strokeStyle = color.border; ctx.strokeRect(lx, ly, r * 2, r * 2);
    }
  }
  function nearest(px: number, py: number): number {
    let best = -1, bd = 18; corners.forEach((c, i) => { const [x, y] = toScr(c); const d = Math.hypot(x - px, y - py); if (d < bd) { bd = d; best = i; } }); return best;
  }
  function pos(e: PointerEvent): [number, number] { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function down(e: PointerEvent): void {
    const [x, y] = pos(e); const n = nearest(x, y);
    if (n >= 0) { drag = n; sel = n; canvas.setPointerCapture(e.pointerId); }
    else if (corners.length < 4) { const p = toImg(x, y); if (p[0] >= 0 && p[1] >= 0 && p[0] <= image.width && p[1] <= image.height) { corners = [...corners, p]; sel = corners.length - 1; onchange?.(corners); } }
    draw();
  }
  function move(e: PointerEvent): void {
    const [x, y] = pos(e); hover = toImg(x, y);
    if (drag >= 0) { const p = toImg(x, y); corners = corners.map((c, i) => (i === drag ? [Math.max(0, Math.min(image.width, p[0])), Math.max(0, Math.min(image.height, p[1]))] as Vec2 : c)); onchange?.(corners); }
    draw();
  }
  function up(): void { drag = -1; draw(); }
  function key(e: KeyboardEvent): void {
    if (sel < 0) return; const st = e.shiftKey ? 10 : 1; const d: Record<string, Vec2> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    const m = d[e.key]; if (!m) return; e.preventDefault();
    corners = corners.map((c, i) => (i === sel ? [c[0] + m[0], c[1] + m[1]] as Vec2 : c)); onchange?.(corners); draw();
  }
  onMount(() => { const ro = new ResizeObserver(() => { const r = wrap.getBoundingClientRect(); W = r.width; H = r.height; draw(); }); ro.observe(wrap); return () => ro.disconnect(); });
  $effect(() => { void corners; void image; draw(); });
</script>

<div class="picker">
  <div class="bar muted">
    {#if corners.length < 4}<b>Ecke {corners.length + 1} von 4:</b> {NAMES[corners.length]} anklicken.{:else}Alle vier Ecken gesetzt. Punkte ziehen oder mit den Pfeiltasten feinjustieren (Umschalt = 10 px).{/if}
    {hint}
  </div>
  <div class="wrap" bind:this={wrap}>
    <canvas bind:this={canvas} tabindex="0" aria-label="Bild mit Wandecken" onpointerdown={down} onpointermove={move} onpointerup={up} onkeydown={key} style="cursor:crosshair"></canvas>
  </div>
</div>

<style>
  .picker { display: flex; flex-direction: column; height: 100%; min-height: 320px; gap: 6px; }
  .wrap { flex: 1; min-height: 0; position: relative; border: 1px solid var(--c-border); border-radius: var(--radius-2); overflow: hidden; }
  canvas { width: 100%; height: 100%; display: block; touch-action: none; }
  .bar { font-size: 13px; }
</style>
