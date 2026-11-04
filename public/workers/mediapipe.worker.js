/* Klassischer Web Worker für MediaPipe Tasks Vision (Pose/Hand).
 * Muss "classic" sein (importScripts im WASM-Loader). Bewusst handgeschrieben und NICHT gebündelt (siehe docs/PLAN.md §4.3).
 * Nachrichten (main → worker):
 *   {type:'init', kind:'pose'|'hand', model:ArrayBuffer, base:'/vendor/mediapipe', numPoses?, numHands?, delegate?:'CPU'|'GPU', mode?:'VIDEO'|'IMAGE'}
 *   {type:'frame', id, t, bitmap, roi?:{x,y,w,h} (nur Hand, Koordinaten des Ursprungsbildes normalisiert)}
 *   {type:'close'}
 * Antworten: {type:'ready'} | {type:'result', id, t, ms, poses:[{keypoints:[{x,y,c}], score}] | hands:[...]} | {type:'error', message}
 */
'use strict';
/* NETZWERKWÄCHTER (Datenschutz): MediaPipe Tasks Vision sendet Nutzungs-Logs an odml.pa.googleapis.com (im E2E-Test beobachtet:
 * POST /v1/log). ClimbVision verbietet jede externe Anfrage. Alles außer same-origin wird hier abgelehnt und gezählt; zusätzlich
 * setzt der Server eine strikte CSP für dieses Skript. Der Zähler wird in der UI angezeigt. */
(function guard() {
  const origin = self.location.origin; let n = 0;
  const same = (u) => { try { return new URL(u, self.location.href).origin === origin; } catch (e) { return false; } };
  const note = (u) => { n++; try { self.postMessage({ type: 'blocked', url: String(u).replace(/^https?:\/\//, '').slice(0, 60), count: n }); } catch (e) { /* egal */ } };
  const realFetch = self.fetch.bind(self);
  self.fetch = function (input, init) { const u = typeof input === 'string' ? input : (input && input.url) || String(input); if (!same(u)) { note(u); return Promise.reject(new TypeError('ClimbVision: externe Anfrage blockiert (' + u.slice(0, 40) + ')')); } return realFetch(input, init); };
  if (self.XMLHttpRequest) { const open = self.XMLHttpRequest.prototype.open; self.XMLHttpRequest.prototype.open = function (m, u) { if (!same(u)) { note(u); throw new Error('ClimbVision: externe Anfrage blockiert'); } return open.apply(this, arguments); }; }
  if (self.navigator && typeof self.navigator.sendBeacon === 'function') { try { self.navigator.sendBeacon = function (u) { note(u); return false; }; } catch (e) { /* schreibgeschützt */ } }
  if (self.WebSocket) { self.WebSocket = function (u) { note(u); throw new Error('ClimbVision: WebSocket im Worker nicht erlaubt'); }; }
})();
let lm = null, kind = null, mode = 'VIDEO', lastTs = 0;
self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === 'init') {
      importScripts(d.base + '/vision_bundle.js');
      const fs = await self.Vision.FilesetResolver.forVisionTasks(d.base + '/wasm');
      kind = d.kind; mode = d.mode || (kind === 'pose' ? 'VIDEO' : 'IMAGE');
      const C = kind === 'hand' ? self.Vision.HandLandmarker : self.Vision.PoseLandmarker;
      const opts = { baseOptions: { modelAssetBuffer: new Uint8Array(d.model), delegate: d.delegate || 'CPU' }, runningMode: mode };
      if (kind === 'hand') opts.numHands = d.numHands || 2; else opts.numPoses = d.numPoses || 1;
      lm = await C.createFromOptions(fs, opts);
      self.postMessage({ type: 'ready', isolated: self.crossOriginIsolated });
    } else if (d.type === 'frame') {
      if (!lm) { d.bitmap.close(); return; }
      const t0 = performance.now();
      let r;
      if (mode === 'VIDEO') { lastTs = Math.max(lastTs + 1, Math.round(d.t)); r = lm.detectForVideo(d.bitmap, lastTs); } else r = lm.detect(d.bitmap);
      const ms = performance.now() - t0;
      d.bitmap.close();
      const roi = d.roi || { x: 0, y: 0, w: 1, h: 1 };
      const map = (p) => ({ x: roi.x + p.x * roi.w, y: roi.y + p.y * roi.h });
      if (kind === 'pose') {
        const poses = (r.landmarks || []).map((l, i) => ({ keypoints: l.map((p) => ({ ...map(p), c: p.visibility === undefined ? 1 : p.visibility })), score: 1 }));
        self.postMessage({ type: 'result', id: d.id, t: d.t, ms, poses });
      } else {
        const hands = (r.landmarks || []).map((l, i) => {
          const hd = (r.handedness && r.handedness[i] && r.handedness[i][0]) || null;
          return { keypoints: l.map((p) => ({ ...map(p), c: 1 })), handedness: hd ? hd.categoryName : null, score: hd ? hd.score : 0.5 };
        });
        self.postMessage({ type: 'result', id: d.id, t: d.t, ms, hands });
      }
    } else if (d.type === 'close') { if (lm) lm.close(); lm = null; }
  } catch (err) { self.postMessage({ type: 'error', message: String((err && err.message) || err) }); }
};
