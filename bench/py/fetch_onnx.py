"""Download RTMPose (Halpe26, body7) + RTMDet-nano person detector ONNX models for the browser benchmark.
URLs are copied from the official MMPose RTMPose README (checked 2026-11-04). NOT downloadable from the M0 cloud sandbox
(download.openmmlab.com is blocked there) -> this script is UNTESTED against the real server. Run it on your laptop.
Usage: python fetch_onnx.py
"""
import io, json, pathlib, urllib.request, zipfile
BASE = 'https://download.openmmlab.com/mmpose/v1/projects/'
MODELS = [  # (output name, url, input w, input h)
    ('rtmpose-t-halpe26', 'rtmposev1/onnx_sdk/rtmpose-t_simcc-body7_pt-body7-halpe26_700e-256x192-6020f8a6_20230605.zip', 192, 256),
    ('rtmpose-s-halpe26', 'rtmposev1/onnx_sdk/rtmpose-s_simcc-body7_pt-body7-halpe26_700e-256x192-7f134165_20230605.zip', 192, 256),
    ('rtmpose-m-halpe26', 'rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip', 192, 256),
]
out = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'models'
out.mkdir(parents=True, exist_ok=True)
manifest = []
for name, rel, w, h in MODELS:
    print('downloading', name)
    data = urllib.request.urlopen(BASE + rel, timeout=120).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        onnx = [n for n in z.namelist() if n.endswith('.onnx')]
        if not onnx: raise SystemExit(f'no .onnx in {name}: {z.namelist()}')
        (out / f'{name}.onnx').write_bytes(z.read(onnx[0]))
    manifest.append({'file': f'{name}.onnx', 'size': {'w': w, 'h': h}})
(out / 'onnx.json').write_text(json.dumps(manifest, indent=2))
print('ok ->', out)
