"""Native (Python, XNNPACK CPU) MediaPipe latency, for a WASM-vs-native ratio. Usage: python bench_mediapipe.py [iters]"""
import sys, time, json, statistics as st
import numpy as np, cv2
import mediapipe as mp
from mediapipe.tasks import python as mpt
from mediapipe.tasks.python import vision

ITERS = int(sys.argv[1]) if len(sys.argv) > 1 else 60
WARM = 15
MODELS = '../web/models/'
img_bgr = cv2.imread('../web/fixtures/bus.jpg')
# 1280x720 letterbox like the browser benchmark
h, w = 720, 1280
k = min(w / img_bgr.shape[1], h / img_bgr.shape[0])
res = cv2.resize(img_bgr, None, fx=k, fy=k)
canvas = np.zeros((h, w, 3), np.uint8)
y0, x0 = (h - res.shape[0]) // 2, (w - res.shape[1]) // 2
canvas[y0:y0 + res.shape[0], x0:x0 + res.shape[1]] = res
rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
mpimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))

def stats(a):
    s = sorted(a); return dict(n=len(a), median=round(s[len(s)//2], 2), mean=round(st.mean(a), 2), p95=round(s[int(len(s)*.95)], 2))

out = []
for m in ('lite', 'full', 'heavy'):
    for mode in ('image', 'video'):
        opts = vision.PoseLandmarkerOptions(
            base_options=mpt.BaseOptions(model_asset_path=f'{MODELS}pose_{m}.task', delegate=mpt.BaseOptions.Delegate.CPU),
            running_mode=vision.RunningMode.IMAGE if mode == 'image' else vision.RunningMode.VIDEO, num_poses=1)
        lm = vision.PoseLandmarker.create_from_options(opts)
        ts, hit, miss = 1000, [], []
        for i in range(WARM + ITERS):
            t = time.perf_counter()
            r = lm.detect(mpimg) if mode == 'image' else lm.detect_for_video(mpimg, ts := ts + 33)
            d = (time.perf_counter() - t) * 1000
            if i >= WARM: (hit if r.pose_landmarks else miss).append(d)
        lm.close()
        row = dict(runtime='mediapipe-python/xnnpack-cpu', model=m, mode=mode, hitRate=round(len(hit)/ITERS, 2), msHit=stats(hit) if hit else None)
        print(json.dumps(row)); out.append(row)
json.dump(out, open('results_mediapipe_py.json', 'w'), indent=2)
