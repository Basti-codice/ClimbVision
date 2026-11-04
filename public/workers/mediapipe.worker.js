/* Klassischer Web Worker für MediaPipe Tasks Vision (Pose/Hand).
 * Muss "classic" sein (importScripts im WASM-Loader). Bewusst handgeschrieben und NICHT gebündelt (siehe docs/PLAN.md §4.3).
 * Nachrichten (main → worker):
 *   {type:'init', kind:'pose'|'hand', model:ArrayBuffer, base:'/vendor/mediapipe', numPoses?, numHands?, delegate?:'CPU'|'GPU', mode?:'VIDEO'|'IMAGE'}
 *   {type:'frame', id, t, bitmap, roi?:{x,y,w,h} (nur Hand, Koordinaten des Ursprungsbildes normalisiert)}
 *   {type:'close'}
 * Antworten: {type:'ready'} | {type:'result', id, t, ms, poses:[{keypoints:[{x,y,c}], score}] | hands:[...]} | {type:'error', message}
 */
'use strict';
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
