// Classic worker: importScripts the UMD bundle
importScripts('/node_modules/@mediapipe/tasks-vision/vision_bundle.js');
let lm, kind, ts = 1000; // timestamps must increase for the lifetime of the landmarker
self.onmessage = async (e) => {
  const d = e.data;
  try {
    if (d.type === 'init') {
      kind = d.kind;
      const fs = await Vision.FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
      const C = kind === 'hand' ? Vision.HandLandmarker : Vision.PoseLandmarker;
      lm = await C.createFromOptions(fs, { baseOptions: { modelAssetPath: d.model, delegate: 'CPU' }, runningMode: 'VIDEO', ...(kind === 'hand' ? { numHands: 2 } : { numPoses: 1 }) });
      self.postMessage({ type: 'ready', hasOffscreen: typeof OffscreenCanvas !== 'undefined', isolated: self.crossOriginIsolated });
    } else if (d.type === 'run') {
      const times = []; let hits = 0;
      for (let i = 0; i < d.warmup + d.iters; i++) {
        const t = performance.now(); const r = lm.detectForVideo(d.bitmap, ts += 33); const dt = performance.now() - t;
        if (i >= d.warmup) { times.push(dt); if ((r.landmarks?.length ?? 0) > 0) hits++; }
      }
      times.sort((a, b) => a - b);
      self.postMessage({ type: 'done', kind, hitRate: hits / d.iters, median: times[times.length >> 1], p95: times[Math.floor(times.length * .95)] });
    }
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
