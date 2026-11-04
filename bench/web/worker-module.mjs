import { FilesetResolver, PoseLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
self.onmessage = async (e) => {
  try {
    const fs = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
    const lm = await PoseLandmarker.createFromOptions(fs, { baseOptions: { modelAssetPath: e.data.model, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 });
    const r = lm.detectForVideo(e.data.bitmap, 1000); self.postMessage({ type: 'ok', poses: r.landmarks.length });
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
