<script lang="ts">
  import { onMount } from 'svelte';
  import type { Hold, Limb } from '../core/schemas';
  import type { LimbRender, RenderState, WallPointer } from './wallTypes';
  import { LIMBS } from '../core/schemas';
  import { color, limbColor, limbQuadrant, limbShape } from '../design/tokens';

  interface Props {
    holds: Hold[]; aspekt: number; background?: ImageBitmap | null; backgroundDim?: number;
    getState?: () => RenderState; showIds?: boolean; showSkeleton?: boolean; showConf?: boolean; debug?: boolean; swap?: boolean;
    selected?: ReadonlySet<number>; overlay?: ((ctx: CanvasRenderingContext2D, tf: (u: number, v: number) => [number, number], zoom: number) => void) | undefined;
    onwall?: ((e: WallPointer) => void) | undefined; staticVersion?: number; cursor?: string; label?: string; fpsOut?: (fps: number) => void;
    fillColors?: Map<number, string> | undefined;
  }
  let { holds, aspekt, background = null, backgroundDim = 0.55, getState, showIds = false, showSkeleton = true, showConf = true, debug = false, swap = false,
    selected, overlay, onwall, staticVersion = 0, cursor = 'default', label = 'Digitale Wandkarte', fpsOut, fillColors }: Props = $props();

  let canvas: HTMLCanvasElement; let wrap: HTMLDivElement;
  let cssW = 0, cssH = 0, dpr = 1;
  let zoom = 1, panX = 0, panY = 0; // Ansicht (Zoom um Mittelpunkt, Verschiebung in CSS-px)
  let staticLayer: HTMLCanvasElement | null = null; let staticDirty = true;
  let raf = 0; let frames = 0, tFps = performance.now();

  const BONES: [number, number][] = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19], [16, 18], [16, 20]];
  const END: Record<Limb, number> = { LH: 15, RH: 16, LF: 31, RF: 32 };

  /** Basis-Rechteck der Wand (contain-Fit) ohne Zoom. */
  function baseRect(): { x: number; y: number; w: number; h: number } {
    const pad = 8; const aw = cssW - 2 * pad, ah = cssH - 2 * pad;
    let w = aw, h = aw / aspekt; if (h > ah) { h = ah; w = ah * aspekt; }
    return { x: (cssW - w) / 2, y: (cssH - h) / 2, w, h };
  }
  function tf(u: number, v: number): [number, number] {
    const b = baseRect();
    return [(cssW / 2 + panX) + (b.x + u * b.w - cssW / 2) * zoom, (cssH / 2 + panY) + (b.y + v * b.h - cssH / 2) * zoom];
  }
  function inv(px: number, py: number): [number, number] {
    const b = baseRect();
    return [((px - (cssW / 2 + panX)) / zoom + cssW / 2 - b.x) / b.w, ((py - (cssH / 2 + panY)) / zoom + cssH / 2 - b.y) / b.h];
  }

  function path(ctx: CanvasRenderingContext2D, poly: [number, number][]): void {
    ctx.beginPath();
    poly.forEach((p, i) => { const [x, y] = tf(p[0], p[1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  }

  function drawStatic(): void {
    if (!staticLayer) staticLayer = document.createElement('canvas');
    staticLayer.width = Math.max(1, Math.round(cssW * dpr)); staticLayer.height = Math.max(1, Math.round(cssH * dpr));
    const ctx = staticLayer.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const [x0, y0] = tf(0, 0), [x1, y1] = tf(1, 1);
    ctx.fillStyle = '#05070a'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    if (background) { ctx.drawImage(background, x0, y0, x1 - x0, y1 - y0); ctx.fillStyle = `rgba(5,7,10,${backgroundDim})`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
    ctx.strokeStyle = color.border; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    const lw = Math.max(1, 1.4 * Math.sqrt(zoom));
    for (const h of holds) {
      path(ctx, h.polygon);
      const fc = fillColors?.get(h.id);
      ctx.fillStyle = fc ?? color.holdFill; ctx.fill();
      const sel = selected?.has(h.id);
      ctx.lineWidth = sel ? lw * 2 : lw; ctx.strokeStyle = sel ? color.accent : color.holdStroke; ctx.stroke();
    }
    if (showIds) {
      ctx.fillStyle = color.textMuted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(8, Math.min(14, (x1 - x0) * 0.011 * Math.sqrt(zoom))); ctx.font = `${fs}px system-ui, sans-serif`;
      for (const h of holds) { const [x, y] = tf(h.schwerpunkt[0], h.schwerpunkt[1]); ctx.fillText(String(h.id), x, y); }
    }
    staticDirty = false;
  }

  function drawMarker(ctx: CanvasRenderingContext2D, limb: Limb, x: number, y: number, r: number, dashed: boolean): void {
    ctx.save();
    ctx.fillStyle = limbColor[limb]; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 2; if (dashed) ctx.setLineDash([3, 2]);
    ctx.beginPath();
    if (limbShape[limb] === 'kreis') ctx.arc(x, y, r, 0, Math.PI * 2); else ctx.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.3);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#04121d'; ctx.font = `700 ${Math.max(8, r * 1.0)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(limb, x, y + 0.5);
    ctx.restore();
  }

  function render(): void {
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    if (staticDirty || !staticLayer) drawStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticLayer as HTMLCanvasElement, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const st = getState?.();
    const byId = new Map<number, Hold>(); for (const h of holds) byId.set(h.id, h);
    if (st) {
      // Leuchtende Griffe: Gliedmaßen → Quadrant-codierte Füllung + Glow; Kontur bleibt erhalten
      const perHold = new Map<number, Limb[]>();
      for (const l of LIMBS) { const s = st.limbs[l]; if (s && s.holdId !== null && s.state !== 'FREE' && s.state !== 'CANDIDATE') { const a = perHold.get(s.holdId) ?? []; a.push(l); perHold.set(s.holdId, a); } }
      for (const [id, limbs] of perHold) {
        const h = byId.get(id); if (!h) continue;
        const [cx, cy] = tf(h.schwerpunkt[0], h.schwerpunkt[1]);
        const [bx0, by0] = tf(h.bbox[0], h.bbox[1]), [bx1, by1] = tf(h.bbox[2], h.bbox[3]);
        const R = Math.max(bx1 - bx0, by1 - by0) + 60;
        for (const l of limbs) {
          const q = limbQuadrant[limbs.length === 1 ? 'LH' : l]; const single = limbs.length === 1;
          const s = st.limbs[l] as LimbRender;
          ctx.save(); path(ctx, h.polygon); ctx.clip();
          ctx.globalAlpha = 0.18 + 0.2 * Math.min(1, s.confidence); ctx.fillStyle = limbColor[l];
          if (single) ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R); else ctx.fillRect(q.sx < 0 ? cx - R : cx, q.sy < 0 ? cy - R : cy, R, R);
          ctx.restore();
          // Glow nur als Strich um die Kontur (im Quadranten) – Konturen bleiben erkennbar
          ctx.save();
          if (!single) { ctx.beginPath(); ctx.rect(q.sx < 0 ? cx - R : cx, q.sy < 0 ? cy - R : cy, R, R); ctx.clip(); }
          path(ctx, h.polygon);
          ctx.shadowColor = limbColor[l]; ctx.shadowBlur = 14 + 10 * Math.min(1, s.confidence);
          ctx.lineWidth = 3; ctx.strokeStyle = limbColor[l]; ctx.globalAlpha = 0.9;
          if (s.state === 'OCCLUDED_HOLD' || s.evidence === 'geschaetzt') ctx.setLineDash([7, 5]);
          ctx.stroke(); ctx.restore();
        }
        path(ctx, h.polygon); ctx.lineWidth = 1.6; ctx.strokeStyle = color.holdStrokeActive; ctx.stroke(); // scharfe Kontur oben
        // Marker + Beschriftung je Gliedmaße
        const r = Math.max(7, Math.min(13, (bx1 - bx0) * 0.25));
        limbs.forEach((l) => {
          const s = st.limbs[l] as LimbRender; const q = limbQuadrant[l];
          const mx = limbs.length === 1 ? cx : cx + q.sx * r * 1.1, my = limbs.length === 1 ? cy : cy + q.sy * r * 1.1;
          drawMarker(ctx, l, mx, my, r, s.state === 'OCCLUDED_HOLD');
          if (showConf) {
            ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#05070a'; ctx.lineWidth = 3; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            const txt = `${Math.round(s.confidence * 100)}%${s.ambiguous ? ' ?' : ''}`; const ty = my + r + 2 + (limbs.length > 1 && q.sy > 0 ? 0 : 0);
            ctx.strokeText(txt, mx, ty); ctx.fillText(txt, mx, ty); ctx.restore();
          }
        });
        if (limbs.some((l) => (st.limbs[l] as LimbRender).ambiguous)) { ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = color.uncertain; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R / 2 + 4, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
      }
      // Kandidaten (Mehrdeutigkeit) auch ohne aktiven Kontakt andeuten
      for (const l of LIMBS) {
        const s = st.limbs[l]; if (!s || s.holdId !== null || !s.ambiguous) continue;
        for (const c of s.candidates ?? []) { const h = byId.get(c.holdId); if (!h) continue; path(ctx, h.polygon); ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = limbColor[l]; ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); }
      }
      // Skelett
      if (showSkeleton && st.skeleton) {
        const sk = st.skeleton; ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        for (const [a, b] of BONES) { const p = sk[a], q = sk[b]; if (!p || !q || p.c < 0.3 || q.c < 0.3) continue; const [x1, y1] = tf(p.u, p.v), [x2, y2] = tf(q.u, q.v); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        ctx.restore();
        for (const l of LIMBS) { const idx = swap ? (END[l] % 2 === 0 ? END[l] - 1 : END[l] + 1) : END[l]; const p = sk[idx]; if (!p || p.c < 0.2) continue; const [x, y] = tf(p.u, p.v); drawMarker(ctx, l, x, y, 6, p.c < 0.5); }
        if (debug) { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '9px system-ui'; sk.forEach((p, i) => { if (!p) return; const [x, y] = tf(p.u, p.v); ctx.fillRect(x - 1.5, y - 1.5, 3, 3); if (zoom >= 1.5) ctx.fillText(`${i}:${p.c.toFixed(1)}`, x + 3, y); }); ctx.restore(); }
      }
      if (debug) {
        for (const l of LIMBS) {
          const s = st.limbs[l]; if (!s || !st.skeleton) continue; const idx = swap ? (END[l] % 2 === 0 ? END[l] - 1 : END[l] + 1) : END[l]; const p = st.skeleton[idx]; if (!p) continue;
          const [px, py] = tf(p.u, p.v);
          for (const c of s.candidates ?? []) { const h = byId.get(c.holdId); if (!h) continue; const [hx, hy] = tf(h.schwerpunkt[0], h.schwerpunkt[1]); ctx.save(); ctx.strokeStyle = limbColor[l]; ctx.globalAlpha = 0.6; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(hx, hy); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.font = '10px ui-monospace, monospace'; ctx.fillText(`${l}→${c.holdId} ${c.score.toFixed(2)} ${Number.isFinite(c.distanceCm) ? c.distanceCm.toFixed(0) + 'cm' : ''}`, (px + hx) / 2, (py + hy) / 2); ctx.restore(); }
        }
      }
    }
    overlay?.(ctx, tf, zoom);
    frames++; const now = performance.now();
    if (now - tFps >= 1000) { fpsOut?.(frames * 1000 / (now - tFps)); frames = 0; tFps = now; }
  }

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    const r = wrap.getBoundingClientRect(); cssW = Math.max(10, r.width); cssH = Math.max(10, r.height);
    canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px'; staticDirty = true;
  }
  onMount(() => {
    resize();
    const ro = new ResizeObserver(resize); ro.observe(wrap);
    const loop = (): void => { render(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  });
  // statische Ebene neu zeichnen, wenn sich Eingaben ändern
  $effect(() => { void holds; void aspekt; void background; void backgroundDim; void selected; void showIds; void staticVersion; void fillColors; staticDirty = true; });

  function ptr(type: WallPointer['type'], e: PointerEvent | MouseEvent): WallPointer {
    const r = canvas.getBoundingClientRect(); const [u, v] = inv(e.clientX - r.left, e.clientY - r.top);
    return { type, u, v, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, button: e.button, zoom };
  }
  let panning = false, lastX = 0, lastY = 0;
  function down(e: PointerEvent): void {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) { panning = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault(); return; }
    onwall?.(ptr('down', e));
  }
  function move(e: PointerEvent): void {
    if (panning) { panX += e.clientX - lastX; panY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; staticDirty = true; return; }
    onwall?.(ptr('move', e));
  }
  function up(e: PointerEvent): void { if (panning) { panning = false; return; } onwall?.(ptr('up', e)); }
  function wheel(e: WheelEvent): void {
    if (!onwall) return; // Zoom nur in Bearbeitungsansichten
    e.preventDefault();
    const r = canvas.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015), nz = Math.max(1, Math.min(12, zoom * k));
    // Zoom um den Mauszeiger
    const f = nz / zoom; panX = mx - cssW / 2 - (mx - cssW / 2 - panX) * f; panY = my - cssH / 2 - (my - cssH / 2 - panY) * f; zoom = nz;
    if (zoom === 1) { panX = 0; panY = 0; } staticDirty = true;
  }
  export function resetView(): void { zoom = 1; panX = 0; panY = 0; staticDirty = true; }
  export function toPng(): Promise<Blob | null> { return new Promise((res) => { render(); canvas.toBlob((b) => res(b), 'image/png'); }); }
  export function element(): HTMLCanvasElement { return canvas; }
</script>

<div class="wrap" bind:this={wrap}>
  <canvas bind:this={canvas} aria-label={label} style:cursor={cursor}
    onpointerdown={down} onpointermove={move} onpointerup={up} ondblclick={(e) => onwall?.(ptr('dblclick', e))} onwheel={wheel} oncontextmenu={(e) => e.preventDefault()}></canvas>
</div>

<style>
  .wrap { position: relative; width: 100%; height: 100%; min-height: 200px; overflow: hidden; touch-action: none; }
  canvas { display: block; }
</style>
